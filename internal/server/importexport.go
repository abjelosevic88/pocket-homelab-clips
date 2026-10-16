package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/abjelosevic88/pocket-homelab-clips/internal/store"
)

// Export is the portable JSON shape of a user's library. Snippets and
// quicklinks use the common launcher field names (name/text/keyword,
// name/link/openWith) so the arrays can be fed into other tools, and vice versa.
type Export struct {
	App        string            `json:"app"`
	Version    string            `json:"version"`
	ExportedAt string            `json:"exported_at"`
	Clips      []store.Clip      `json:"clips,omitempty"`
	Snippets   []exportSnippet   `json:"snippets"`
	Quicklinks []exportQuicklink `json:"quicklinks"`
}

type exportSnippet struct {
	Name    string `json:"name"`
	Text    string `json:"text"`
	Keyword string `json:"keyword,omitempty"`
	Folder  string `json:"folder,omitempty"`
	Shared  bool   `json:"shared,omitempty"`
	Pinned  bool   `json:"pinned,omitempty"`
}

type exportQuicklink struct {
	Name     string `json:"name"`
	Link     string `json:"link"`
	Keyword  string `json:"keyword,omitempty"`
	Icon     string `json:"icon,omitempty"`
	OpenWith string `json:"openWith,omitempty"`
	Folder   string `json:"folder,omitempty"`
	Shared   bool   `json:"shared,omitempty"`
	Pinned   bool   `json:"pinned,omitempty"`
}

// handleExport: GET /export?what=snippets|quicklinks|all (default all, clips
// included only with ?clips=1). ?bare=1 returns just the snippets or
// quicklinks array instead of the wrapped export.
func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	what := r.URL.Query().Get("what")
	ex := Export{App: "pocket-clips", Version: Version, ExportedAt: store.Now(), Snippets: []exportSnippet{}, Quicklinks: []exportQuicklink{}}
	if what == "" || what == "all" || what == "snippets" {
		list, _, err := s.store.ListSnippets(r.Context(), store.LibraryFilter{UserID: u.ID, Mine: true, Limit: 500})
		if err != nil {
			s.fail(w, err, "export")
			return
		}
		for _, x := range list {
			ex.Snippets = append(ex.Snippets, exportSnippet{Name: x.Name, Text: x.Content, Keyword: x.Keyword, Folder: x.Folder, Shared: x.Shared, Pinned: x.Pinned})
		}
	}
	if what == "" || what == "all" || what == "quicklinks" {
		list, _, err := s.store.ListQuicklinks(r.Context(), store.LibraryFilter{UserID: u.ID, Mine: true, Limit: 500})
		if err != nil {
			s.fail(w, err, "export")
			return
		}
		for _, x := range list {
			ex.Quicklinks = append(ex.Quicklinks, exportQuicklink{Name: x.Name, Link: x.Link, Keyword: x.Keyword, Icon: x.Icon, OpenWith: x.OpenWith, Folder: x.Folder, Shared: x.Shared, Pinned: x.Pinned})
		}
	}
	if queryBool(r, "clips") || what == "clips" {
		list, _, err := s.store.ListClips(r.Context(), store.ClipFilter{UserID: u.ID, Limit: 500})
		if err != nil {
			s.fail(w, err, "export")
			return
		}
		ex.Clips = list
	}
	name := "pocket-clips-" + time.Now().Format("20060102") + ".json"
	if queryBool(r, "bare") {
		switch what {
		case "snippets":
			name = "pocket-clips-snippets.json"
			w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
			writeJSON(w, http.StatusOK, ex.Snippets)
		case "quicklinks":
			name = "pocket-clips-quicklinks.json"
			w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
			writeJSON(w, http.StatusOK, ex.Quicklinks)
		default:
			writeErr(w, http.StatusBadRequest, "bare=1 needs what=snippets or what=quicklinks")
		}
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	writeJSON(w, http.StatusOK, ex)
}

// handleImport accepts our own export, or a bare array: snippets
// ([{name,text,keyword}]) and quicklinks ([{name,link,openWith}]) are told
// apart by their fields. Existing identical items are skipped.
func (s *Server) handleImport(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	var raw json.RawMessage
	if err := decode(r, &raw); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	var ex Export
	trimmed := strings.TrimSpace(string(raw))
	if strings.HasPrefix(trimmed, "[") {
		var items []map[string]any
		if err := json.Unmarshal(raw, &items); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid json array")
			return
		}
		for _, it := range items {
			str := func(k string) string { v, _ := it[k].(string); return v }
			if str("link") != "" {
				ex.Quicklinks = append(ex.Quicklinks, exportQuicklink{Name: str("name"), Link: str("link"), Keyword: str("keyword"), Icon: str("icon"), OpenWith: firstNonEmpty(str("openWith"), str("open_with")), Folder: str("folder")})
			} else if str("text") != "" || str("content") != "" {
				ex.Snippets = append(ex.Snippets, exportSnippet{Name: str("name"), Text: firstNonEmpty(str("text"), str("content")), Keyword: str("keyword"), Folder: str("folder")})
			}
		}
	} else if err := json.Unmarshal(raw, &ex); err != nil {
		writeErr(w, http.StatusBadRequest, "not a Pocket Clips export")
		return
	}
	res := map[string]int{"snippets": 0, "quicklinks": 0, "clips": 0, "skipped": 0}
	for _, x := range ex.Snippets {
		if strings.TrimSpace(x.Text) == "" {
			res["skipped"]++
			continue
		}
		if x.Name == "" {
			x.Name = firstWords(x.Text, 6)
		}
		if s.store.SnippetExists(r.Context(), u.ID, x.Name, x.Text) {
			res["skipped"]++
			continue
		}
		k, ok := cleanKeyword(x.Keyword)
		if !ok {
			k = ""
		}
		sn := &store.Snippet{UserID: u.ID, Name: x.Name, Keyword: k, Content: x.Text, Folder: x.Folder, Shared: x.Shared, Pinned: x.Pinned}
		if err := s.store.CreateSnippet(r.Context(), sn); err != nil {
			sn.Keyword = "" // keyword taken: import without it
			if err := s.store.CreateSnippet(r.Context(), sn); err != nil {
				res["skipped"]++
				continue
			}
		}
		res["snippets"]++
	}
	for _, x := range ex.Quicklinks {
		in := quicklinkIn{Name: x.Name, Keyword: x.Keyword, Link: x.Link, Icon: x.Icon, OpenWith: x.OpenWith, Folder: x.Folder}
		q := &store.Quicklink{UserID: u.ID, Shared: x.Shared, Pinned: x.Pinned}
		if !in.applyQuiet(q) || s.store.QuicklinkExists(r.Context(), u.ID, q.Link) {
			res["skipped"]++
			continue
		}
		if err := s.store.CreateQuicklink(r.Context(), q); err != nil {
			q.Keyword = ""
			if err := s.store.CreateQuicklink(r.Context(), q); err != nil {
				res["skipped"]++
				continue
			}
		}
		res["quicklinks"]++
	}
	for _, c := range ex.Clips {
		if c.Kind == store.KindImage || strings.TrimSpace(c.Content) == "" {
			res["skipped"]++
			continue
		}
		nc := store.Clip{UserID: u.ID, Kind: c.Kind, Content: c.Content, Title: c.Title, SourceApp: c.SourceApp, SourceDevice: c.SourceDevice, Bytes: c.Bytes, Chars: c.Chars, Words: c.Words, Lines: c.Lines, Pinned: c.Pinned}
		if !store.ValidKind(nc.Kind) {
			nc.Kind = store.KindText
		}
		if created, err := s.store.AddClip(r.Context(), &nc); err != nil || !created {
			res["skipped"]++
			continue
		}
		if c.Pinned {
			nc.Pinned = true
			_ = s.store.UpdateClip(r.Context(), &nc)
		}
		res["clips"]++
	}
	writeJSON(w, http.StatusOK, res)
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// applyQuiet is apply without an http.ResponseWriter, for imports.
func (in *quicklinkIn) applyQuiet(x *store.Quicklink) bool {
	rec := &nullWriter{}
	return in.apply(x, rec)
}

type nullWriter struct{}

func (n *nullWriter) Header() http.Header         { return http.Header{} }
func (n *nullWriter) Write(b []byte) (int, error) { return len(b), nil }
func (n *nullWriter) WriteHeader(int)             {}
