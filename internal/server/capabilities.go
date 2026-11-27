package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"unicode"

	"github.com/abjelosevic88/pocket-homelab-clips/internal/store"
	core "github.com/abjelosevic88/pocket-homelab-core/sdk"
)

// The three routes behind `capabilities` (links.go): /api/v1/pocket/search,
// /widget and /capture. Each runs as the request's person and sees only their
// own snippets (never someone else's shared ones, never a clip); the SDK's
// handlers check and cap what goes in and out.

// snippetURL opens a snippet in the app (the Snippets page's ?edit= deep link).
func snippetURL(id int64) string {
	return "/snippets?edit=" + strconv.FormatInt(id, 10)
}

// snippetLine is a snippet's line of context: its folder and the start of its
// text, on one line.
func snippetLine(x *store.Snippet) string {
	text := strings.Join(strings.Fields(x.Content), " ")
	if r := []rune(text); len(r) > 80 {
		text = strings.TrimSpace(string(r[:79])) + "…"
	}
	if x.Folder == "" {
		return text
	}
	if text == "" {
		return x.Folder
	}
	return x.Folder + " · " + text
}

func hasWord(q string) bool {
	return strings.IndexFunc(q, func(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }) >= 0
}

// ---------- search ----------

// pocketSearch is the snippet search of GET /snippets (name, keyword, folder
// and text; pinned first, then best match), limited to the person's own.
func (s *Server) pocketSearch(r *http.Request, q string, limit int) ([]core.SearchItem, error) {
	if !hasWord(q) {
		return nil, nil
	}
	list, _, err := s.store.ListSnippets(r.Context(), store.LibraryFilter{UserID: userFrom(r.Context()).ID, Query: q, Mine: true, Limit: limit})
	if err != nil {
		return nil, err
	}
	out := make([]core.SearchItem, 0, len(list))
	for i := range list {
		x := &list[i]
		out = append(out, core.SearchItem{ID: strconv.FormatInt(x.ID, 10), Title: x.Name, Snippet: snippetLine(x), Kind: "snippet", Date: x.UpdatedAt, URL: snippetURL(x.ID)})
	}
	return out, nil
}

// ---------- widget ----------

func usedTimes(n int) string {
	switch n {
	case 0:
		return ""
	case 1:
		return "used once"
	}
	return "used " + strconv.Itoa(n) + " times"
}

// pocketWidget lists the person's pinned snippets, then the ones used most
// and last, then the newest: the shelf to copy from. Nothing for a person
// without snippets.
func (s *Server) pocketWidget(r *http.Request) (*core.WidgetData, error) {
	list, err := s.store.TopSnippets(r.Context(), userFrom(r.Context()).ID, 8)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	out := &core.WidgetData{URL: "/snippets"}
	for i := range list {
		x := &list[i]
		var detail []string
		if x.Folder != "" {
			detail = append(detail, x.Folder)
		}
		if u := usedTimes(x.UseCount); u != "" {
			detail = append(detail, u)
		}
		out.Items = append(out.Items, core.WidgetItem{ID: strconv.FormatInt(x.ID, 10), Title: x.Name, Detail: strings.Join(detail, " · "), URL: snippetURL(x.ID)})
	}
	return out, nil
}

// ---------- capture ----------

// actingApp is the Pocket app a link token in this request acts for ("hub"),
// empty when the person asked themself. Introspection is cached by the SDK,
// so this costs nothing after requireAuth.
func (s *Server) actingApp(ctx context.Context, r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(strings.ToLower(h), "bearer ") {
		return ""
	}
	tok := strings.TrimSpace(h[7:])
	if !s.core.Configured() || !core.IsLinkToken(tok) {
		return ""
	}
	in, err := s.core.Introspect(ctx, tok)
	if err != nil || in.App == nil {
		return ""
	}
	return in.App.Slug
}

// pocketCapture keeps a quick line as a new snippet of the person's, the way
// "New snippet" makes one: no folder, no keyword, not shared, named after the
// title sent with it or the line's first words. It never touches the
// clipboard history. The same request_id again answers the same snippet and
// adds nothing: the receipt is written in the transaction that adds it.
func (s *Server) pocketCapture(r *http.Request, in core.CaptureInput) (*core.CaptureResult, error) {
	ctx, u := r.Context(), userFrom(r.Context())
	op, err := core.NewOperation(fmt.Sprintf("clips:user:%d:%s:%s", u.ID, s.actingApp(ctx, r), core.CapturePath), in.RequestID, in)
	if err != nil {
		return nil, err
	}
	s.captureMu.Lock()
	defer s.captureMu.Unlock()

	var res core.CaptureResult
	found, err := op.Replay(ctx, s.store.DB, &res)
	switch {
	case errors.Is(err, core.ErrOperationConflict):
		return nil, fmt.Errorf("%w: this was already kept with other words", core.ErrCapture)
	case err != nil:
		return nil, err
	case found:
		return &res, nil
	}

	// A title alone is the line itself.
	text := in.Text
	if text == "" {
		text = in.Title
	}
	name := strings.Join(strings.Fields(in.Title), " ")
	if name == "" {
		name = firstWords(text, 6)
	}
	if r := []rune(name); len(r) > 200 {
		name = strings.TrimSpace(string(r[:199])) + "…"
	}
	x := &store.Snippet{UserID: u.ID, Name: name, Content: text}
	err = s.createSnippet(ctx, u, x, func(tx *sql.Tx) error {
		res = core.CaptureResult{ID: strconv.FormatInt(x.ID, 10), Title: x.Name, URL: snippetURL(x.ID)}
		return op.Save(ctx, tx, res)
	})
	if err != nil {
		return nil, err
	}
	return &res, nil
}
