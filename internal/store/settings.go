package store

import (
	"context"
	"strconv"
)

// DefaultTitle is the app title until someone changes it.
const DefaultTitle = "Pocket Clips"

// GetSettings loads all settings with defaults applied.
func (s *Store) GetSettings(ctx context.Context) (Settings, error) {
	st := Settings{Title: DefaultTitle, ClipRetentionDays: 90, MaxClips: 10000, FetchLinkTitles: true}
	rows, err := s.DB.QueryContext(ctx, `SELECT key, value FROM settings`)
	if err != nil {
		return st, err
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return st, err
		}
		switch k {
		case "title":
			if v != "" {
				st.Title = v
			}
		case "clip_retention_days":
			if n, err := strconv.Atoi(v); err == nil && n >= 0 {
				st.ClipRetentionDays = n
			}
		case "max_clips":
			if n, err := strconv.Atoi(v); err == nil && n >= 0 {
				st.MaxClips = n
			}
		case "fetch_link_titles":
			st.FetchLinkTitles = v != "0"
		case "setup_complete":
			st.SetupComplete = v == "1"
		}
	}
	return st, rows.Err()
}

// SaveSettings persists all settings.
func (s *Store) SaveSettings(ctx context.Context, st Settings) error {
	b := map[bool]string{true: "1", false: "0"}
	kv := map[string]string{
		"title":               st.Title,
		"clip_retention_days": strconv.Itoa(st.ClipRetentionDays),
		"max_clips":           strconv.Itoa(st.MaxClips),
		"fetch_link_titles":   b[st.FetchLinkTitles],
		"setup_complete":      b[st.SetupComplete],
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	for k, v := range kv {
		if _, err := tx.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, k, v); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}
