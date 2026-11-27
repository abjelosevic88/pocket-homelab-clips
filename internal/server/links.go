package server

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/abjelosevic88/pocket-homelab-clips/internal/store"
	core "github.com/abjelosevic88/pocket-homelab-core/sdk"
)

// portable is what Pocket Move may copy out and bring in (docs/move.md in
// pocket-homelab-core), for the person the link acts for.
var portable = &core.Portable{
	Exports: []core.PortableExport{
		{Path: "/api/v1/export", File: "clips.json", Kind: core.KindPocket, Title: "Your snippets and quicklinks, with their keywords and folders"},
	},
	Imports: []core.PortableImport{
		{Path: "/api/v1/import", Kind: core.KindPocket, ContentType: "application/json", MaxBytes: 32 << 20, Title: "Adds the snippets and quicklinks from another box; ones you already have are skipped"},
	},
}

// capabilities are what Pocket Search and Pocket Hub may ask here for a
// person (docs/capabilities.md in pocket-homelab-core): one value for the
// manifest, the /pocket routes and linkAllows. Only snippets, which the
// person wrote to reuse: the clipboard history holds passwords and codes and
// never leaves through these routes. No day feed: what was copied on a day is
// nothing for a journal.
var capabilities = core.Capabilities{
	Search:  &core.Searchable{What: "Your snippets, by name, keyword, folder and text", Kinds: []string{"snippet"}, Bangs: []string{"clips", "snippet"}},
	Widget:  &core.Widget{Title: "Snippets", What: "Your pinned snippets and the ones you use most"},
	Capture: &core.QuickCapture{Kinds: []core.CaptureKind{{Kind: "snippet", Label: "Snippet", What: "A new snippet with this text", Fields: []string{"title"}}}},
}

var errLinkScope = errors.New("outside the link's scope")

// linkAllows reports whether a pcx_ link token with these scopes may make
// this request: Pocket Move's routes and the capability routes, each with its
// own scope, and who the link acts for.
func linkAllows(scopes []string, r *http.Request) bool {
	if r.Method == http.MethodGet && r.URL.Path == "/api/v1/auth/me" {
		return true
	}
	return portable.LinkAllows(scopes, r) || capabilities.LinkAllows(scopes, r)
}

// linkUser validates a pcx_ token and maps it to the person it acts for.
func (s *Server) linkUser(ctx context.Context, tok string, r *http.Request) (*store.User, error) {
	in, err := s.core.Introspect(ctx, tok)
	if err != nil {
		return nil, err
	}
	if !in.Active || !in.Delegated() || in.User == nil || in.User.Email == "" {
		return nil, http.ErrNoCookie
	}
	if !linkAllows(strings.Fields(in.Scope), r) {
		return nil, errLinkScope
	}
	return s.coreIdentityUser(ctx, in)
}
