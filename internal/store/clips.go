package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	core "github.com/abjelosevic88/pocket-homelab-core/sdk"
	"strings"
	"time"
)

// ClipFilter narrows a clipboard listing.
type ClipFilter struct {
	UserID int64
	Query  string
	Kind   string // "" = all
	Pinned *bool
	Limit  int
	Offset int
}

const clipCols = `c.id, c.user_id, c.kind, c.content, c.title, c.source_app, c.source_device, c.bytes, c.chars, c.words, c.lines, c.width, c.height, c.pinned, c.copy_count, c.first_copied_at, c.last_copied_at`

func scanClip(row interface{ Scan(...any) error }, withSnippet bool) (*Clip, error) {
	var c Clip
	var pinned int
	dst := []any{&c.ID, &c.UserID, &c.Kind, &c.Content, &c.Title, &c.SourceApp, &c.SourceDevice, &c.Bytes, &c.Chars, &c.Words, &c.Lines, &c.Width, &c.Height, &pinned, &c.CopyCount, &c.FirstCopiedAt, &c.LastCopiedAt}
	if withSnippet {
		dst = append(dst, &c.Snippet)
	}
	if err := row.Scan(dst...); err != nil {
		return nil, notFound(err)
	}
	c.Pinned = pinned == 1
	return &c, nil
}

// HashContent returns the dedupe key for a clip's content.
func HashContent(kind, content string) string {
	h := sha256.Sum256([]byte(kind + "\x00" + content))
	return hex.EncodeToString(h[:])
}

// AddClip inserts a clip or, when the same content was copied before, bumps
// that row to the top. Returns the stored clip and whether it was new.
func (s *Store) AddClip(ctx context.Context, c *Clip, after ...core.CommitHook) (bool, error) {
	c.Content = strings.TrimRight(c.Content, "\n")
	if c.Content == "" {
		return false, fmt.Errorf("empty content")
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	hash := HashContent(c.Kind, c.Content)
	now := Now()
	var existing int64
	err = tx.QueryRowContext(ctx, `SELECT id FROM clips WHERE user_id = ? AND content_hash = ?`, c.UserID, hash).Scan(&existing)
	if err == nil {
		_, err = tx.ExecContext(ctx, `UPDATE clips SET last_copied_at = ?, copy_count = copy_count + 1,
			source_app = CASE WHEN ? <> '' THEN ? ELSE source_app END,
			source_device = CASE WHEN ? <> '' THEN ? ELSE source_device END WHERE id = ?`, now, c.SourceApp, c.SourceApp, c.SourceDevice, c.SourceDevice, existing)
		if err != nil {
			return false, err
		}
		got, err := scanClip(tx.QueryRowContext(ctx, `SELECT `+clipCols+` FROM clips c WHERE c.id=? AND c.user_id=?`, existing, c.UserID), false)
		if err != nil {
			return false, err
		}
		*c = *got
		return false, tx.Commit()
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO clips (user_id, kind, content, content_hash, title, source_app, source_device, bytes, chars, words, lines, width, height, first_copied_at, last_copied_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, c.UserID, c.Kind, c.Content, hash, c.Title, c.SourceApp, c.SourceDevice, c.Bytes, c.Chars, c.Words, c.Lines, c.Width, c.Height, now, now)
	if err != nil {
		return false, conflict(err)
	}
	c.ID, _ = res.LastInsertId()
	c.FirstCopiedAt, c.LastCopiedAt, c.CopyCount = now, now, 1
	return true, core.Commit(tx, after...)
}

// GetClip returns one clip of the user.
func (s *Store) GetClip(ctx context.Context, userID, id int64) (*Clip, error) {
	return scanClip(s.DB.QueryRowContext(ctx, `SELECT `+clipCols+` FROM clips c WHERE c.id = ? AND c.user_id = ?`, id, userID), false)
}

// ListClips returns clips newest first (pinned on top), or ranked by relevance when searching.
func (s *Store) ListClips(ctx context.Context, f ClipFilter) ([]Clip, int, error) {
	if f.Limit <= 0 || f.Limit > 500 {
		f.Limit = 100
	}
	where := []string{"c.user_id = ?"}
	args := []any{f.UserID}
	if f.Kind != "" {
		where = append(where, "c.kind = ?")
		args = append(args, f.Kind)
	}
	if f.Pinned != nil {
		where = append(where, "c.pinned = ?")
		args = append(args, boolInt(*f.Pinned))
	}
	q, fts := searchTerms(f.Query)
	var sql, countSQL string
	cols := clipCols
	if fts != "" {
		where = append(where, "clips_fts MATCH ?")
		args = append(args, fts)
		cols += `, snippet(clips_fts, 0, '<mark>', '</mark>', '…', 24)`
		sql = `SELECT ` + cols + ` FROM clips_fts JOIN clips c ON c.id = clips_fts.rowid WHERE ` + strings.Join(where, " AND ") + ` ORDER BY c.pinned DESC, bm25(clips_fts, 1.0, 2.0, 0.5), c.last_copied_at DESC`
		countSQL = `SELECT COUNT(1) FROM clips_fts JOIN clips c ON c.id = clips_fts.rowid WHERE ` + strings.Join(where, " AND ")
	} else {
		if q != "" {
			// Single symbols and such that FTS cannot tokenize: fall back to LIKE.
			where = append(where, `(c.content LIKE ? ESCAPE '\' OR c.title LIKE ? ESCAPE '\')`)
			p := LikePattern(q)
			args = append(args, p, p)
		}
		sql = `SELECT ` + cols + ` FROM clips c WHERE ` + strings.Join(where, " AND ") + ` ORDER BY c.pinned DESC, c.last_copied_at DESC`
		countSQL = `SELECT COUNT(1) FROM clips c WHERE ` + strings.Join(where, " AND ")
	}
	var total int
	if err := s.DB.QueryRowContext(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if fts != "" && total == 0 {
		// Nothing tokenised matched ("#", "::", a substring inside a word): fall back to LIKE.
		f.Query = "\x00" + q
		return s.ListClips(ctx, f)
	}
	rows, err := s.DB.QueryContext(ctx, sql+` LIMIT ? OFFSET ?`, append(args, f.Limit, f.Offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []Clip{}
	for rows.Next() {
		c, err := scanClip(rows, fts != "")
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *c)
	}
	return out, total, rows.Err()
}

// UpdateClip saves title and pinned (the content of a clip never changes).
func (s *Store) UpdateClip(ctx context.Context, c *Clip) error {
	res, err := s.DB.ExecContext(ctx, `UPDATE clips SET title = ?, pinned = ? WHERE id = ? AND user_id = ?`, c.Title, boolInt(c.Pinned), c.ID, c.UserID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// TouchClip marks a clip as copied again: it moves to the top.
func (s *Store) TouchClip(ctx context.Context, userID, id int64) (*Clip, error) {
	if _, err := s.DB.ExecContext(ctx, `UPDATE clips SET last_copied_at = ?, copy_count = copy_count + 1 WHERE id = ? AND user_id = ?`, Now(), id, userID); err != nil {
		return nil, err
	}
	return s.GetClip(ctx, userID, id)
}

// DeleteClip removes one clip and returns it (so the caller can remove an image file).
func (s *Store) DeleteClip(ctx context.Context, userID, id int64) (*Clip, error) {
	c, err := s.GetClip(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	_, err = s.DB.ExecContext(ctx, `DELETE FROM clips WHERE id = ? AND user_id = ?`, id, userID)
	return c, err
}

// ClearClips deletes unpinned clips of a user, optionally of one kind, and
// returns the stored file names of removed images.
func (s *Store) ClearClips(ctx context.Context, userID int64, kind string, includePinned bool) (int64, []string, error) {
	where := "user_id = ?"
	args := []any{userID}
	if kind != "" {
		where += " AND kind = ?"
		args = append(args, kind)
	}
	if !includePinned {
		where += " AND pinned = 0"
	}
	files, err := s.imageFiles(ctx, where, args)
	if err != nil {
		return 0, nil, err
	}
	res, err := s.DB.ExecContext(ctx, `DELETE FROM clips WHERE `+where, args...)
	if err != nil {
		return 0, nil, err
	}
	n, _ := res.RowsAffected()
	return n, files, nil
}

func (s *Store) imageFiles(ctx context.Context, where string, args []any) ([]string, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT content FROM clips WHERE kind = 'image' AND `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var f string
		if err := rows.Scan(&f); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// PurgeClips applies the retention policy for every user: unpinned clips
// older than retentionDays go, then anything beyond maxClips (oldest first).
// Returns how many rows were removed and the image files to delete.
func (s *Store) PurgeClips(ctx context.Context, retentionDays, maxClips int) (int64, []string, error) {
	var total int64
	var files []string
	if retentionDays > 0 {
		cutoff := time.Now().UTC().AddDate(0, 0, -retentionDays).Format(time.RFC3339Nano)
		where := "pinned = 0 AND last_copied_at < ?"
		f, err := s.imageFiles(ctx, where, []any{cutoff})
		if err != nil {
			return 0, nil, err
		}
		files = append(files, f...)
		res, err := s.DB.ExecContext(ctx, `DELETE FROM clips WHERE `+where, cutoff)
		if err != nil {
			return 0, nil, err
		}
		n, _ := res.RowsAffected()
		total += n
	}
	if maxClips > 0 {
		rows, err := s.DB.QueryContext(ctx, `SELECT user_id FROM clips GROUP BY user_id HAVING COUNT(1) > ?`, maxClips)
		if err != nil {
			return 0, nil, err
		}
		var users []int64
		for rows.Next() {
			var u int64
			if err := rows.Scan(&u); err == nil {
				users = append(users, u)
			}
		}
		rows.Close()
		for _, u := range users {
			where := `user_id = ? AND pinned = 0 AND id NOT IN (SELECT id FROM clips WHERE user_id = ? ORDER BY pinned DESC, last_copied_at DESC LIMIT ?)`
			args := []any{u, u, maxClips}
			f, err := s.imageFiles(ctx, where, args)
			if err != nil {
				return 0, nil, err
			}
			files = append(files, f...)
			res, err := s.DB.ExecContext(ctx, `DELETE FROM clips WHERE `+where, args...)
			if err != nil {
				return 0, nil, err
			}
			n, _ := res.RowsAffected()
			total += n
		}
	}
	return total, files, nil
}

// ImageInUse reports whether any clip (of any user) still points at the stored
// image file. Image files are content-addressed, so two people who copied the
// same picture share one file; it may only go when the last row is gone.
func (s *Store) ImageInUse(ctx context.Context, name string) bool {
	var n int
	if err := s.DB.QueryRowContext(ctx, `SELECT COUNT(1) FROM clips WHERE kind = 'image' AND content = ?`, name).Scan(&n); err != nil {
		return true // when in doubt, keep the file
	}
	return n > 0
}

// SetClipTitle stores a looked-up title (only if still empty).
func (s *Store) SetClipTitle(ctx context.Context, id int64, title string) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE clips SET title = ? WHERE id = ? AND title = ''`, title, id)
	return err
}

// ClipStats summarises a user's history for the dashboard.
type ClipStats struct {
	Total      int            `json:"clips"`
	Today      int            `json:"clips_today"`
	Pinned     int            `json:"pinned_clips"`
	ByKind     map[string]int `json:"by_kind"`
	LastClipAt string         `json:"last_clip_at"`
	LastClip   string         `json:"last_clip_text"`
}

// Stats returns clip counts for the user.
func (s *Store) Stats(ctx context.Context, userID int64) (ClipStats, error) {
	st := ClipStats{ByKind: map[string]int{}}
	today := time.Now().UTC().Format("2006-01-02")
	if err := s.DB.QueryRowContext(ctx, `SELECT COUNT(1), COALESCE(SUM(pinned),0), COALESCE(SUM(last_copied_at >= ?),0) FROM clips WHERE user_id = ?`, today, userID).Scan(&st.Total, &st.Pinned, &st.Today); err != nil {
		return st, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT kind, COUNT(1) FROM clips WHERE user_id = ? GROUP BY kind`, userID)
	if err != nil {
		return st, err
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		var n int
		if err := rows.Scan(&k, &n); err == nil {
			st.ByKind[k] = n
		}
	}
	_ = s.DB.QueryRowContext(ctx, `SELECT last_copied_at, CASE WHEN kind = 'image' THEN '[image]' ELSE substr(content, 1, 80) END FROM clips WHERE user_id = ? ORDER BY last_copied_at DESC LIMIT 1`, userID).Scan(&st.LastClipAt, &st.LastClip)
	return st, nil
}
