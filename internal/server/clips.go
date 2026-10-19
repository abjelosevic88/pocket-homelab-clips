package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"html"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/abjelosevic88/pocket-homelab-clips/internal/clipkind"
	"github.com/abjelosevic88/pocket-homelab-clips/internal/store"
)

func (s *Server) handleListClips(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	f := store.ClipFilter{UserID: u.ID, Query: r.URL.Query().Get("q"), Kind: r.URL.Query().Get("kind"), Limit: queryInt(r, "limit"), Offset: queryInt(r, "offset")}
	if f.Kind != "" && !store.ValidKind(f.Kind) {
		writeErr(w, http.StatusBadRequest, "unknown kind")
		return
	}
	if v := r.URL.Query().Get("pinned"); v != "" {
		p := queryBool(r, "pinned")
		f.Pinned = &p
	}
	list, total, err := s.store.ListClips(r.Context(), f)
	if err != nil {
		s.fail(w, err, "list clips")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clips": list, "total": total})
}

// handleCreateClip accepts JSON {content, kind?, title?, source_app?,
// source_device?}, a raw text body, or multipart/form-data with a "file"
// (an image) plus optional fields.
func (s *Server) handleCreateClip(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	c := &store.Clip{UserID: u.ID}
	switch {
	case strings.HasPrefix(ct, "multipart/"):
		if err := r.ParseMultipartForm(s.cfg.MaxImageBytes + 1<<20); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid multipart body")
			return
		}
		c.SourceApp, c.SourceDevice, c.Title = r.FormValue("source_app"), r.FormValue("source_device"), r.FormValue("title")
		file, hdr, err := r.FormFile("file")
		if err != nil {
			// multipart without a file: treat "content" as text
			c.Content, c.Kind = r.FormValue("content"), r.FormValue("kind")
			break
		}
		defer file.Close()
		if err := s.storeImage(c, file, hdr.Filename, hdr.Header.Get("Content-Type")); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
	case ct == "application/json" || ct == "":
		var in struct {
			Content      string `json:"content"`
			Kind         string `json:"kind"`
			Title        string `json:"title"`
			SourceApp    string `json:"source_app"`
			SourceDevice string `json:"source_device"`
		}
		if err := decode(r, &in); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid json")
			return
		}
		c.Content, c.Kind, c.Title, c.SourceApp, c.SourceDevice = in.Content, in.Kind, in.Title, in.SourceApp, in.SourceDevice
	default: // text/plain etc.: the body is the clip
		b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, s.cfg.MaxClipBytes))
		if err != nil {
			writeErr(w, http.StatusRequestEntityTooLarge, "clip too large")
			return
		}
		c.Content = string(b)
		c.Kind, c.SourceApp, c.SourceDevice = r.URL.Query().Get("kind"), r.URL.Query().Get("source_app"), r.URL.Query().Get("source_device")
	}
	if c.Kind != store.KindImage {
		if strings.TrimSpace(c.Content) == "" {
			writeErr(w, http.StatusBadRequest, "content is required")
			return
		}
		if int64(len(c.Content)) > s.cfg.MaxClipBytes {
			writeErr(w, http.StatusRequestEntityTooLarge, "clip too large")
			return
		}
		if c.Kind == "" || c.Kind == store.KindText {
			c.Kind = clipkind.Detect(c.Content)
		}
		if !store.ValidKind(c.Kind) {
			writeErr(w, http.StatusBadRequest, "unknown kind")
			return
		}
		c.Bytes, c.Chars, c.Words, c.Lines = clipkind.Stats(c.Content)
	}
	c.Title = clipkind.FirstLine(c.Title, 200)
	created, err := s.store.AddClip(r.Context(), c)
	if err != nil {
		s.fail(w, err, "add clip")
		return
	}
	if created && c.Kind == store.KindLink && c.Title == "" {
		if st, err := s.store.GetSettings(r.Context()); err == nil && st.FetchLinkTitles && s.cfg.LinkTitles {
			go s.fetchLinkTitle(c.ID, c.Content)
		}
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
		s.publish("clips.clip_created", fmt.Sprintf("clip:%d", c.ID), map[string]any{
			"clip_id": c.ID, "kind": c.Kind, "title": c.Title, "source_app": c.SourceApp, "source_device": c.SourceDevice,
			"bytes": c.Bytes, "chars": c.Chars, "words": c.Words, "lines": c.Lines, "user_id": c.UserID,
		})
	}
	writeJSON(w, status, c)
}

func (s *Server) storeImage(c *store.Clip, file io.Reader, filename, declared string) error {
	data, err := io.ReadAll(io.LimitReader(file, s.cfg.MaxImageBytes+1))
	if err != nil {
		return err
	}
	if int64(len(data)) > s.cfg.MaxImageBytes {
		return &userError{"image too large"}
	}
	if len(data) == 0 {
		return &userError{"empty file"}
	}
	ext := strings.ToLower(filepath.Ext(filename))
	cfg, format, derr := image.DecodeConfig(bytes.NewReader(data))
	if derr == nil {
		c.Width, c.Height = cfg.Width, cfg.Height
		ext = "." + format
		if format == "jpeg" {
			ext = ".jpg"
		}
	} else if ext == "" {
		switch declared {
		case "image/webp":
			ext = ".webp"
		case "image/svg+xml":
			ext = ".svg"
		default:
			return &userError{"not a recognised image (png, jpeg, gif, webp, svg)"}
		}
	}
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".heic", ".bmp", ".tiff", ".tif":
	default:
		return &userError{"unsupported image type " + ext}
	}
	sum := sha256.Sum256(data)
	name := hex.EncodeToString(sum[:16]) + ext
	if err := os.MkdirAll(s.cfg.ImagesDir, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(s.cfg.ImagesDir, name), data, 0o644); err != nil {
		return err
	}
	c.Kind, c.Content, c.Bytes = store.KindImage, name, int64(len(data))
	if c.Title == "" && filename != "" && !strings.HasPrefix(filename, "blob") && filename != "image.png" {
		c.Title = filename
	}
	return nil
}

type userError struct{ msg string }

func (e *userError) Error() string { return e.msg }

var titleRe = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)

// fetchLinkTitle looks up the page title of a copied URL in the background.
func (s *Server) fetchLinkTitle(id int64, link string) {
	if strings.HasPrefix(strings.ToLower(link), "www.") {
		link = "https://" + link
	}
	req, err := http.NewRequest(http.MethodGet, link, nil)
	if err != nil {
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; PocketClips/"+Version+"; +https://github.com/abjelosevic88/pocket-homelab-clips)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	resp, err := s.http.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 || !strings.Contains(resp.Header.Get("Content-Type"), "html") {
		return
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 512<<10))
	m := titleRe.FindSubmatch(body)
	if m == nil {
		return
	}
	title := clipkind.FirstLine(html.UnescapeString(string(m[1])), 200)
	if title == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = s.store.SetClipTitle(ctx, id, title)
}

func (s *Server) handleGetClip(w http.ResponseWriter, r *http.Request) {
	c, err := s.store.GetClip(r.Context(), userFrom(r.Context()).ID, idParam(r, "id"))
	if err != nil {
		s.fail(w, err, "get clip")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// handleClipRaw returns the content as text/plain (for curl | pbcopy).
func (s *Server) handleClipRaw(w http.ResponseWriter, r *http.Request) {
	c, err := s.store.GetClip(r.Context(), userFrom(r.Context()).ID, idParam(r, "id"))
	if err != nil {
		s.fail(w, err, "get clip")
		return
	}
	if c.Kind == store.KindImage {
		s.handleClipImage(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = io.WriteString(w, c.Content)
}

func (s *Server) handleClipImage(w http.ResponseWriter, r *http.Request) {
	c, err := s.store.GetClip(r.Context(), userFrom(r.Context()).ID, idParam(r, "id"))
	if err != nil {
		s.fail(w, err, "get clip")
		return
	}
	if c.Kind != store.KindImage || strings.ContainsAny(c.Content, "/\\") {
		writeErr(w, http.StatusNotFound, "not an image")
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeFile(w, r, filepath.Join(s.cfg.ImagesDir, c.Content))
}

func (s *Server) handleUpdateClip(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	c, err := s.store.GetClip(r.Context(), u.ID, idParam(r, "id"))
	if err != nil {
		s.fail(w, err, "get clip")
		return
	}
	var in struct {
		Title  *string `json:"title"`
		Pinned *bool   `json:"pinned"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if in.Title != nil {
		c.Title = clipkind.FirstLine(*in.Title, 200)
	}
	if in.Pinned != nil {
		c.Pinned = *in.Pinned
	}
	if err := s.store.UpdateClip(r.Context(), c); err != nil {
		s.fail(w, err, "update clip")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) handleTouchClip(w http.ResponseWriter, r *http.Request) {
	c, err := s.store.TouchClip(r.Context(), userFrom(r.Context()).ID, idParam(r, "id"))
	if err != nil {
		s.fail(w, err, "touch clip")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) handleDeleteClip(w http.ResponseWriter, r *http.Request) {
	c, err := s.store.DeleteClip(r.Context(), userFrom(r.Context()).ID, idParam(r, "id"))
	if err != nil {
		s.fail(w, err, "delete clip")
		return
	}
	if c.Kind == store.KindImage {
		s.removeImages([]string{c.Content})
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleClearClips wipes the history: ?kind= for one type, ?pinned=1 to include pinned clips.
func (s *Server) handleClearClips(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	if kind != "" && !store.ValidKind(kind) {
		writeErr(w, http.StatusBadRequest, "unknown kind")
		return
	}
	n, files, err := s.store.ClearClips(r.Context(), userFrom(r.Context()).ID, kind, queryBool(r, "pinned"))
	if err != nil {
		s.fail(w, err, "clear clips")
		return
	}
	s.removeImages(files)
	writeJSON(w, http.StatusOK, map[string]any{"deleted": n})
}
