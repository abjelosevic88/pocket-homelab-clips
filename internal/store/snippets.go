package store

import (
	"context"
	"strings"
)

// LibraryFilter narrows a snippet or quicklink listing. Items visible to a
// user are their own plus the ones others shared.
type LibraryFilter struct {
	UserID  int64
	Query   string
	Folder  string
	Mine    bool // only the user's own
	Limit   int
	Offset  int
	Keyword string
}

const snippetCols = `s.id, s.user_id, COALESCE(u.name, u.email, ''), s.name, s.keyword, s.content, s.folder, s.shared, s.pinned, s.use_count, s.last_used_at, s.created_at, s.updated_at`

func scanSnippet(row interface{ Scan(...any) error }, withSnippet bool) (*Snippet, error) {
	var x Snippet
	var shared, pinned int
	dst := []any{&x.ID, &x.UserID, &x.OwnerName, &x.Name, &x.Keyword, &x.Content, &x.Folder, &shared, &pinned, &x.UseCount, &x.LastUsedAt, &x.CreatedAt, &x.UpdatedAt}
	if withSnippet {
		dst = append(dst, &x.Snippet)
	}
	if err := row.Scan(dst...); err != nil {
		return nil, notFound(err)
	}
	x.Shared, x.Pinned = shared == 1, pinned == 1
	x.Arguments = ParseArguments(x.Content)
	return &x, nil
}

func visible(alias string, f LibraryFilter) (string, []any) {
	if f.Mine {
		return alias + ".user_id = ?", []any{f.UserID}
	}
	return "(" + alias + ".user_id = ? OR " + alias + ".shared = 1)", []any{f.UserID}
}

// ListSnippets returns snippets visible to the user, pinned first then by name,
// or ranked by relevance when searching.
func (s *Store) ListSnippets(ctx context.Context, f LibraryFilter) ([]Snippet, int, error) {
	if f.Limit <= 0 || f.Limit > 500 {
		f.Limit = 200
	}
	w, args := visible("s", f)
	where := []string{w}
	if f.Folder != "" {
		where = append(where, "s.folder = ?")
		args = append(args, f.Folder)
	}
	if f.Keyword != "" {
		where = append(where, "s.keyword = ?")
		args = append(args, f.Keyword)
	}
	q, fts := searchTerms(f.Query)
	cols := snippetCols
	var sql, countSQL string
	if fts != "" {
		where = append(where, "snippets_fts MATCH ?")
		args = append(args, fts)
		cols += `, snippet(snippets_fts, 2, '<mark>', '</mark>', '…', 20)`
		sql = `SELECT ` + cols + ` FROM snippets_fts JOIN snippets s ON s.id = snippets_fts.rowid LEFT JOIN users u ON u.id = s.user_id WHERE ` + strings.Join(where, " AND ") + ` ORDER BY s.pinned DESC, bm25(snippets_fts, 3.0, 4.0, 1.0, 1.0), s.use_count DESC`
		countSQL = `SELECT COUNT(1) FROM snippets_fts JOIN snippets s ON s.id = snippets_fts.rowid WHERE ` + strings.Join(where, " AND ")
	} else {
		if q != "" {
			where = append(where, `(s.name LIKE ? ESCAPE '\' OR s.keyword LIKE ? ESCAPE '\' OR s.content LIKE ? ESCAPE '\')`)
			p := LikePattern(q)
			args = append(args, p, p, p)
		}
		sql = `SELECT ` + cols + ` FROM snippets s LEFT JOIN users u ON u.id = s.user_id WHERE ` + strings.Join(where, " AND ") + ` ORDER BY s.pinned DESC, s.use_count DESC, s.name COLLATE NOCASE`
		countSQL = `SELECT COUNT(1) FROM snippets s WHERE ` + strings.Join(where, " AND ")
	}
	var total int
	if err := s.DB.QueryRowContext(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if fts != "" && total == 0 {
		f.Query = "\x00" + q
		return s.ListSnippets(ctx, f)
	}
	rows, err := s.DB.QueryContext(ctx, sql+` LIMIT ? OFFSET ?`, append(args, f.Limit, f.Offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []Snippet{}
	for rows.Next() {
		x, err := scanSnippet(rows, fts != "")
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *x)
	}
	return out, total, rows.Err()
}

// GetSnippet returns a snippet the user may see.
func (s *Store) GetSnippet(ctx context.Context, userID, id int64) (*Snippet, error) {
	return scanSnippet(s.DB.QueryRowContext(ctx, `SELECT `+snippetCols+` FROM snippets s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ? AND (s.user_id = ? OR s.shared = 1)`, id, userID), false)
}

// GetSnippetByKeyword resolves a keyword: the user's own first, then shared ones.
func (s *Store) GetSnippetByKeyword(ctx context.Context, userID int64, keyword string) (*Snippet, error) {
	return scanSnippet(s.DB.QueryRowContext(ctx, `SELECT `+snippetCols+` FROM snippets s LEFT JOIN users u ON u.id = s.user_id WHERE s.keyword = ? AND (s.user_id = ? OR s.shared = 1) ORDER BY s.user_id = ? DESC LIMIT 1`, keyword, userID, userID), false)
}

// GetSnippetByName resolves {snippet name="…"} references (case-insensitive).
func (s *Store) GetSnippetByName(ctx context.Context, userID int64, name string) (*Snippet, error) {
	return scanSnippet(s.DB.QueryRowContext(ctx, `SELECT `+snippetCols+` FROM snippets s LEFT JOIN users u ON u.id = s.user_id WHERE s.name = ? COLLATE NOCASE AND (s.user_id = ? OR s.shared = 1) ORDER BY s.user_id = ? DESC LIMIT 1`, name, userID, userID), false)
}

// CreateSnippet inserts a snippet.
func (s *Store) CreateSnippet(ctx context.Context, x *Snippet) error {
	res, err := s.DB.ExecContext(ctx, `INSERT INTO snippets (user_id, name, keyword, content, folder, shared, pinned) VALUES (?, ?, ?, ?, ?, ?, ?)`, x.UserID, x.Name, x.Keyword, x.Content, x.Folder, boolInt(x.Shared), boolInt(x.Pinned))
	if err != nil {
		return conflict(err)
	}
	x.ID, _ = res.LastInsertId()
	return nil
}

// UpdateSnippet saves an owner's edits.
func (s *Store) UpdateSnippet(ctx context.Context, x *Snippet) error {
	res, err := s.DB.ExecContext(ctx, `UPDATE snippets SET name = ?, keyword = ?, content = ?, folder = ?, shared = ?, pinned = ?, updated_at = ? WHERE id = ? AND user_id = ?`, x.Name, x.Keyword, x.Content, x.Folder, boolInt(x.Shared), boolInt(x.Pinned), Now(), x.ID, x.UserID)
	if err != nil {
		return conflict(err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteSnippet removes an owner's snippet.
func (s *Store) DeleteSnippet(ctx context.Context, userID, id int64) error {
	res, err := s.DB.ExecContext(ctx, `DELETE FROM snippets WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// UseSnippet counts a use.
func (s *Store) UseSnippet(ctx context.Context, id int64) {
	_, _ = s.DB.ExecContext(ctx, `UPDATE snippets SET use_count = use_count + 1, last_used_at = ? WHERE id = ?`, Now(), id)
}

// SnippetExists reports whether the user already has that name+content (for imports).
func (s *Store) SnippetExists(ctx context.Context, userID int64, name, content string) bool {
	var n int
	_ = s.DB.QueryRowContext(ctx, `SELECT COUNT(1) FROM snippets WHERE user_id = ? AND name = ? AND content = ?`, userID, name, content).Scan(&n)
	return n > 0
}

// Folders lists the folder names in use in one table (snippets or quicklinks) for the user.
func (s *Store) Folders(ctx context.Context, userID int64, table string) ([]string, error) {
	if table != "snippets" && table != "quicklinks" {
		return []string{}, nil
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT DISTINCT folder FROM `+table+` WHERE (user_id = ? OR shared = 1) AND folder <> '' ORDER BY folder COLLATE NOCASE`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var f string
		if err := rows.Scan(&f); err == nil {
			out = append(out, f)
		}
	}
	return out, rows.Err()
}
