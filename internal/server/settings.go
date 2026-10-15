package server

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/abjelosevic88/pocket-homelab-clips/internal/store"
)

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	st, err := s.store.GetSettings(r.Context())
	if err != nil {
		s.fail(w, err, "settings")
		return
	}
	writeJSON(w, http.StatusOK, s.publicSettings(st))
}

// publicSettings adds what the UI needs to know about the environment.
func (s *Server) publicSettings(st store.Settings) map[string]any {
	return map[string]any{
		"title": st.Title, "clip_retention_days": st.ClipRetentionDays, "max_clips": st.MaxClips,
		"fetch_link_titles": st.FetchLinkTitles, "link_titles_enabled": s.cfg.LinkTitles,
		"max_clip_bytes": s.cfg.MaxClipBytes, "max_image_bytes": s.cfg.MaxImageBytes,
		"setup_complete": st.SetupComplete,
	}
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	cur, err := s.store.GetSettings(r.Context())
	if err != nil {
		s.fail(w, err, "settings")
		return
	}
	var in store.Settings
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if strings.TrimSpace(in.Title) == "" {
		in.Title = store.DefaultTitle
	}
	if in.ClipRetentionDays < 0 || in.ClipRetentionDays > 3650 {
		writeErr(w, http.StatusBadRequest, "retention must be between 0 (forever) and 3650 days")
		return
	}
	if in.MaxClips < 0 || in.MaxClips > 1_000_000 {
		writeErr(w, http.StatusBadRequest, "max clips must be between 0 (unlimited) and 1,000,000")
		return
	}
	in.SetupComplete = cur.SetupComplete
	if err := s.store.SaveSettings(r.Context(), in); err != nil {
		s.fail(w, err, "save settings")
		return
	}
	writeJSON(w, http.StatusOK, s.publicSettings(in))
}

func (s *Server) handleSystemInfo(w http.ResponseWriter, r *http.Request) {
	var size, images int64
	if fi, err := os.Stat(s.cfg.DBPath); err == nil {
		size = fi.Size()
	}
	if entries, err := os.ReadDir(s.cfg.ImagesDir); err == nil {
		for _, e := range entries {
			if fi, err := e.Info(); err == nil {
				images += fi.Size()
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"version": Version, "go": runtime.Version(), "os": runtime.GOOS, "arch": runtime.GOARCH,
		"auth_mode": s.cfg.AuthMode, "data_dir": s.cfg.DataDir, "db_path": s.cfg.DBPath, "db_bytes": size, "images_bytes": images,
		"uptime": time.Since(s.started).Round(time.Second).String(), "timezone": time.Now().Location().String(),
		"counts": s.store.Counts(r.Context()),
	})
}

func (s *Server) handleBackup(w http.ResponseWriter, r *http.Request) {
	dir := filepath.Join(s.cfg.DataDir, "backups")
	name := fmt.Sprintf("pocket-clips-%s.db", time.Now().Format("20060102-150405"))
	dst := filepath.Join(dir, name)
	if err := s.store.Backup(r.Context(), dst); err != nil {
		s.fail(w, err, "backup")
		return
	}
	defer os.Remove(dst)
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("Content-Type", "application/vnd.sqlite3")
	http.ServeFile(w, r, dst)
}

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	st, err := s.store.Stats(r.Context(), u.ID)
	if err != nil {
		s.fail(w, err, "stats")
		return
	}
	_, snippets, _ := s.store.ListSnippets(r.Context(), store.LibraryFilter{UserID: u.ID, Limit: 1})
	_, links, _ := s.store.ListQuicklinks(r.Context(), store.LibraryFilter{UserID: u.ID, Limit: 1})
	writeJSON(w, http.StatusOK, map[string]any{
		"clips": st.Total, "clips_today": st.Today, "pinned_clips": st.Pinned, "by_kind": st.ByKind,
		"last_clip_at": st.LastClipAt, "last_clip_text": st.LastClip, "last_clip_ago": ago(st.LastClipAt),
		"snippets": snippets, "quicklinks": links,
	})
}

func ago(ts string) string {
	if ts == "" {
		return "never"
	}
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return ""
	}
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd ago", int(d.Hours()/24))
	}
}

func (s *Server) handleFolders(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	sn, err := s.store.Folders(r.Context(), u.ID, "snippets")
	if err != nil {
		s.fail(w, err, "folders")
		return
	}
	ql, err := s.store.Folders(r.Context(), u.ID, "quicklinks")
	if err != nil {
		s.fail(w, err, "folders")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"snippets": sn, "quicklinks": ql})
}
