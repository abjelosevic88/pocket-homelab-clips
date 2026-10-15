package server

import (
	"net/http"
	"strings"

	"github.com/abjelosevic88/pocket-homelab-clips/internal/store"
)

// handleSearch is the one box that finds everything: clips, snippets and
// quicklinks in one round trip, each group ranked on its own.
//
//	GET /search?q=inv&limit=20&types=clips,snippets,quicklinks
//
// With an empty q it returns the recent clips plus pinned snippets and
// quicklinks: what the palette shows before you type.
func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	limit := queryInt(r, "limit")
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	types := map[string]bool{"clips": true, "snippets": true, "quicklinks": true}
	if t := r.URL.Query().Get("types"); t != "" {
		types = map[string]bool{}
		for _, x := range strings.Split(t, ",") {
			types[strings.TrimSpace(x)] = true
		}
	}
	out := map[string]any{"q": q}
	if types["clips"] {
		list, total, err := s.store.ListClips(r.Context(), store.ClipFilter{UserID: u.ID, Query: q, Kind: r.URL.Query().Get("kind"), Limit: limit})
		if err != nil {
			s.fail(w, err, "search clips")
			return
		}
		out["clips"], out["clips_total"] = list, total
	}
	if types["snippets"] {
		list, total, err := s.store.ListSnippets(r.Context(), store.LibraryFilter{UserID: u.ID, Query: q, Limit: limit})
		if err != nil {
			s.fail(w, err, "search snippets")
			return
		}
		out["snippets"], out["snippets_total"] = list, total
	}
	if types["quicklinks"] {
		list, total, err := s.store.ListQuicklinks(r.Context(), store.LibraryFilter{UserID: u.ID, Query: q, Limit: limit})
		if err != nil {
			s.fail(w, err, "search quicklinks")
			return
		}
		out["quicklinks"], out["quicklinks_total"] = list, total
	}
	writeJSON(w, http.StatusOK, out)
}
