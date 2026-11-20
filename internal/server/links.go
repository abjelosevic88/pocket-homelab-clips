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

var errLinkScope = errors.New("outside the link's scope")

// linkAllows reports whether a pcx_ link token with these scopes may make
// this request. Clips offers nothing but Pocket Move's routes.
func linkAllows(scopes []string, r *http.Request) bool {
	return portable.LinkAllows(scopes, r)
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
