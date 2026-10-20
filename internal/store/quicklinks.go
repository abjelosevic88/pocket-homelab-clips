package store

import (
	"context"
	core "github.com/abjelosevic88/pocket-homelab-core/sdk"
	"strings"
)

const quicklinkCols = `q.id, q.user_id, COALESCE(u.name, u.email, ''), q.name, q.keyword, q.link, q.icon, q.open_with, q.folder, q.shared, q.pinned, q.use_count, q.last_used_at, q.created_at, q.updated_at`

func scanQuicklink(row interface{ Scan(...any) error }) (*Quicklink, error) {
	var x Quicklink
	var shared, pinned int
	if err := row.Scan(&x.ID, &x.UserID, &x.OwnerName, &x.Name, &x.Keyword, &x.Link, &x.Icon, &x.OpenWith, &x.Folder, &shared, &pinned, &x.UseCount, &x.LastUsedAt, &x.CreatedAt, &x.UpdatedAt); err != nil {
		return nil, notFound(err)
	}
	x.Shared, x.Pinned = shared == 1, pinned == 1
	x.Arguments = ParseArguments(x.Link)
	return &x, nil
}

// ListQuicklinks returns quicklinks visible to the user.
func (s *Store) ListQuicklinks(ctx context.Context, f LibraryFilter) ([]Quicklink, int, error) {
	if f.Limit <= 0 || f.Limit > 500 {
		f.Limit = 200
	}
	w, args := visible("q", f)
	where := []string{w}
	if f.Folder != "" {
		where = append(where, "q.folder = ?")
		args = append(args, f.Folder)
	}
	qs, fts := searchTerms(f.Query)
	var sql, countSQL string
	if fts != "" {
		where = append(where, "quicklinks_fts MATCH ?")
		args = append(args, fts)
		sql = `SELECT ` + quicklinkCols + ` FROM quicklinks_fts JOIN quicklinks q ON q.id = quicklinks_fts.rowid LEFT JOIN users u ON u.id = q.user_id WHERE ` + strings.Join(where, " AND ") + ` ORDER BY q.pinned DESC, bm25(quicklinks_fts, 3.0, 4.0, 1.0, 1.0), q.use_count DESC`
		countSQL = `SELECT COUNT(1) FROM quicklinks_fts JOIN quicklinks q ON q.id = quicklinks_fts.rowid WHERE ` + strings.Join(where, " AND ")
	} else {
		if qs != "" {
			where = append(where, `(q.name LIKE ? ESCAPE '\' OR q.keyword LIKE ? ESCAPE '\' OR q.link LIKE ? ESCAPE '\')`)
			p := LikePattern(qs)
			args = append(args, p, p, p)
		}
		sql = `SELECT ` + quicklinkCols + ` FROM quicklinks q LEFT JOIN users u ON u.id = q.user_id WHERE ` + strings.Join(where, " AND ") + ` ORDER BY q.pinned DESC, q.use_count DESC, q.name COLLATE NOCASE`
		countSQL = `SELECT COUNT(1) FROM quicklinks q WHERE ` + strings.Join(where, " AND ")
	}
	var total int
	if err := s.DB.QueryRowContext(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if fts != "" && total == 0 {
		f.Query = "\x00" + qs
		return s.ListQuicklinks(ctx, f)
	}
	rows, err := s.DB.QueryContext(ctx, sql+` LIMIT ? OFFSET ?`, append(args, f.Limit, f.Offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []Quicklink{}
	for rows.Next() {
		x, err := scanQuicklink(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *x)
	}
	return out, total, rows.Err()
}

// GetQuicklink returns a quicklink the user may see.
func (s *Store) GetQuicklink(ctx context.Context, userID, id int64) (*Quicklink, error) {
	return scanQuicklink(s.DB.QueryRowContext(ctx, `SELECT `+quicklinkCols+` FROM quicklinks q LEFT JOIN users u ON u.id = q.user_id WHERE q.id = ? AND (q.user_id = ? OR q.shared = 1)`, id, userID))
}

// GetQuicklinkByKeyword resolves a keyword: the user's own first, then shared ones.
func (s *Store) GetQuicklinkByKeyword(ctx context.Context, userID int64, keyword string) (*Quicklink, error) {
	return scanQuicklink(s.DB.QueryRowContext(ctx, `SELECT `+quicklinkCols+` FROM quicklinks q LEFT JOIN users u ON u.id = q.user_id WHERE q.keyword = ? AND (q.user_id = ? OR q.shared = 1) ORDER BY q.user_id = ? DESC, q.id LIMIT 1`, keyword, userID, userID))
}

// CreateQuicklink inserts a quicklink.
func (s *Store) CreateQuicklink(ctx context.Context, x *Quicklink, after ...core.CommitHook) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `INSERT INTO quicklinks (user_id, name, keyword, link, icon, open_with, folder, shared, pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, x.UserID, x.Name, x.Keyword, x.Link, x.Icon, x.OpenWith, x.Folder, boolInt(x.Shared), boolInt(x.Pinned))
	if err != nil {
		return conflict(err)
	}
	x.ID, _ = res.LastInsertId()
	return core.Commit(tx, after...)
}

// UpdateQuicklink saves an owner's edits.
func (s *Store) UpdateQuicklink(ctx context.Context, x *Quicklink) error {
	res, err := s.DB.ExecContext(ctx, `UPDATE quicklinks SET name = ?, keyword = ?, link = ?, icon = ?, open_with = ?, folder = ?, shared = ?, pinned = ?, updated_at = ? WHERE id = ? AND user_id = ?`, x.Name, x.Keyword, x.Link, x.Icon, x.OpenWith, x.Folder, boolInt(x.Shared), boolInt(x.Pinned), Now(), x.ID, x.UserID)
	if err != nil {
		return conflict(err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteQuicklink removes an owner's quicklink.
func (s *Store) DeleteQuicklink(ctx context.Context, userID, id int64) error {
	res, err := s.DB.ExecContext(ctx, `DELETE FROM quicklinks WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// UseQuicklink counts an open. Only the owner's own opens count: using a
// quicklink someone shared never writes to their row.
func (s *Store) UseQuicklink(ctx context.Context, userID, id int64) {
	_, _ = s.DB.ExecContext(ctx, `UPDATE quicklinks SET use_count = use_count + 1, last_used_at = ? WHERE id = ? AND user_id = ?`, Now(), id, userID)
}

// QuicklinkExists reports whether the user already has that link (for imports).
func (s *Store) QuicklinkExists(ctx context.Context, userID int64, link string) bool {
	var n int
	_ = s.DB.QueryRowContext(ctx, `SELECT COUNT(1) FROM quicklinks WHERE user_id = ? AND link = ?`, userID, link).Scan(&n)
	return n > 0
}
