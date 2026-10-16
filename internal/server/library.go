package server

import (
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/abjelosevic88/pocket-homelab-clips/internal/snippet"
	"github.com/abjelosevic88/pocket-homelab-clips/internal/store"
)

var keywordRe = regexp.MustCompile(`^[\p{L}\p{N}_.:\-/!@#$%&*+=?~]{1,40}$`)

func cleanKeyword(k string) (string, bool) {
	k = strings.TrimSpace(k)
	if k == "" {
		return "", true
	}
	return k, keywordRe.MatchString(k)
}

func libFilter(r *http.Request) store.LibraryFilter {
	return store.LibraryFilter{UserID: userFrom(r.Context()).ID, Query: r.URL.Query().Get("q"), Folder: r.URL.Query().Get("folder"), Mine: queryBool(r, "mine"), Limit: queryInt(r, "limit"), Offset: queryInt(r, "offset"), Keyword: r.URL.Query().Get("keyword")}
}

// ---------- snippets ----------

type snippetIn struct {
	Name    string `json:"name"`
	Keyword string `json:"keyword"`
	Content string `json:"content"`
	Text    string `json:"text"` // accepted as an alias of content
	Folder  string `json:"folder"`
	Shared  *bool  `json:"shared"`
	Pinned  *bool  `json:"pinned"`
}

func (in *snippetIn) apply(x *store.Snippet, w http.ResponseWriter) bool {
	if in.Content == "" {
		in.Content = in.Text
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" && in.Content != "" {
		in.Name = firstWords(in.Content, 6)
	}
	if in.Name == "" || strings.TrimSpace(in.Content) == "" {
		writeErr(w, http.StatusBadRequest, "name and content are required")
		return false
	}
	k, ok := cleanKeyword(in.Keyword)
	if !ok {
		writeErr(w, http.StatusBadRequest, "keyword: letters, digits and a few symbols, up to 40 characters, no spaces")
		return false
	}
	x.Name, x.Keyword, x.Content, x.Folder = in.Name, k, in.Content, strings.TrimSpace(in.Folder)
	if in.Shared != nil {
		x.Shared = *in.Shared
	}
	if in.Pinned != nil {
		x.Pinned = *in.Pinned
	}
	return true
}

func firstWords(s string, n int) string {
	f := strings.Fields(s)
	if len(f) > n {
		f = f[:n]
	}
	return strings.Join(f, " ")
}

func (s *Server) handleListSnippets(w http.ResponseWriter, r *http.Request) {
	list, total, err := s.store.ListSnippets(r.Context(), libFilter(r))
	if err != nil {
		s.fail(w, err, "list snippets")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"snippets": list, "total": total})
}

func (s *Server) handleCreateSnippet(w http.ResponseWriter, r *http.Request) {
	var in snippetIn
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	x := &store.Snippet{UserID: userFrom(r.Context()).ID}
	if !in.apply(x, w) {
		return
	}
	if err := s.store.CreateSnippet(r.Context(), x); err != nil {
		if err == store.ErrConflict {
			writeErr(w, http.StatusConflict, "you already have a snippet with that keyword")
			return
		}
		s.fail(w, err, "create snippet")
		return
	}
	out, _ := s.store.GetSnippet(r.Context(), x.UserID, x.ID)
	writeJSON(w, http.StatusCreated, out)
}

func (s *Server) handleGetSnippet(w http.ResponseWriter, r *http.Request) {
	x, err := s.store.GetSnippet(r.Context(), userFrom(r.Context()).ID, idParam(r, "id"))
	if err != nil {
		s.fail(w, err, "get snippet")
		return
	}
	writeJSON(w, http.StatusOK, x)
}

func (s *Server) ownSnippet(w http.ResponseWriter, r *http.Request) *store.Snippet {
	u := userFrom(r.Context())
	x, err := s.store.GetSnippet(r.Context(), u.ID, idParam(r, "id"))
	if err != nil {
		s.fail(w, err, "get snippet")
		return nil
	}
	if x.UserID != u.ID && u.Role != "admin" {
		writeErr(w, http.StatusForbidden, "only the owner can change a shared snippet")
		return nil
	}
	return x
}

func (s *Server) handleUpdateSnippet(w http.ResponseWriter, r *http.Request) {
	x := s.ownSnippet(w, r)
	if x == nil {
		return
	}
	var in snippetIn
	keys, err := decodeKeys(r, &in)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	// Partial updates: keep what was not sent.
	if !keys["name"] {
		in.Name = x.Name
	}
	if !keys["content"] && !keys["text"] {
		in.Content = x.Content
	}
	if !keys["keyword"] {
		in.Keyword = x.Keyword
	}
	if !keys["folder"] {
		in.Folder = x.Folder
	}
	if !in.apply(x, w) {
		return
	}
	if err := s.store.UpdateSnippet(r.Context(), x); err != nil {
		if err == store.ErrConflict {
			writeErr(w, http.StatusConflict, "you already have a snippet with that keyword")
			return
		}
		s.fail(w, err, "update snippet")
		return
	}
	out, _ := s.store.GetSnippet(r.Context(), userFrom(r.Context()).ID, x.ID)
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleDeleteSnippet(w http.ResponseWriter, r *http.Request) {
	x := s.ownSnippet(w, r)
	if x == nil {
		return
	}
	if err := s.store.DeleteSnippet(r.Context(), x.UserID, x.ID); err != nil {
		s.fail(w, err, "delete snippet")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type expandIn struct {
	ID        int64             `json:"id"`
	Keyword   string            `json:"keyword"`
	Name      string            `json:"name"`
	Args      map[string]string `json:"args"`
	Clipboard string            `json:"clipboard"`
	Selection string            `json:"selection"`
}

func (s *Server) expand(r *http.Request, x *store.Snippet, in expandIn) snippet.Result {
	u := userFrom(r.Context())
	res := snippet.Expand(x.Content, snippet.Input{Clipboard: in.Clipboard, Selection: in.Selection, Args: in.Args, Lookup: func(name string) (string, bool) {
		o, err := s.store.GetSnippetByName(r.Context(), u.ID, name)
		if err != nil {
			return "", false
		}
		return o.Content, true
	}})
	if !queryBool(r, "dry") {
		s.store.UseSnippet(r.Context(), x.ID)
	}
	return res
}

func (s *Server) handleExpandSnippet(w http.ResponseWriter, r *http.Request) {
	x, err := s.store.GetSnippet(r.Context(), userFrom(r.Context()).ID, idParam(r, "id"))
	if err != nil {
		s.fail(w, err, "get snippet")
		return
	}
	var in expandIn
	_ = decode(r, &in)
	writeJSON(w, http.StatusOK, s.expand(r, x, in))
}

// handleExpandByKeyword: GET /snippets/expand?keyword=sig&arg.name=Ana (text/plain)
// or POST {keyword|name|id, args, clipboard} (JSON).
func (s *Server) handleExpandByKeyword(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	var in expandIn
	plain := r.Method == http.MethodGet
	if plain {
		q := r.URL.Query()
		in.Keyword, in.Name, in.Clipboard, in.Selection = q.Get("keyword"), q.Get("name"), q.Get("clipboard"), q.Get("selection")
		in.ID, _ = strconv.ParseInt(q.Get("id"), 10, 64)
		in.Args = map[string]string{}
		for k, v := range q {
			if strings.HasPrefix(k, "arg.") && len(v) > 0 {
				in.Args[k[4:]] = v[0]
			}
		}
	} else if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	var x *store.Snippet
	var err error
	switch {
	case in.ID != 0:
		x, err = s.store.GetSnippet(r.Context(), u.ID, in.ID)
	case in.Keyword != "":
		x, err = s.store.GetSnippetByKeyword(r.Context(), u.ID, in.Keyword)
	case in.Name != "":
		x, err = s.store.GetSnippetByName(r.Context(), u.ID, in.Name)
	default:
		writeErr(w, http.StatusBadRequest, "id, keyword or name is required")
		return
	}
	if err != nil {
		s.fail(w, err, "find snippet")
		return
	}
	res := s.expand(r, x, in)
	if plain && !queryBool(r, "json") {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = io.WriteString(w, res.Text)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ---------- quicklinks ----------

type quicklinkIn struct {
	Name      string `json:"name"`
	Keyword   string `json:"keyword"`
	Link      string `json:"link"`
	Icon      string `json:"icon"`
	OpenWith  string `json:"open_with"`
	OpenWith2 string `json:"openWith"` // camelCase alias of open_with
	Folder    string `json:"folder"`
	Shared    *bool  `json:"shared"`
	Pinned    *bool  `json:"pinned"`
}

func (in *quicklinkIn) apply(x *store.Quicklink, w http.ResponseWriter) bool {
	in.Name, in.Link = strings.TrimSpace(in.Name), strings.TrimSpace(in.Link)
	if in.OpenWith == "" {
		in.OpenWith = in.OpenWith2
	}
	if in.Link == "" {
		writeErr(w, http.StatusBadRequest, "link is required")
		return false
	}
	if !strings.Contains(in.Link, "://") && !strings.HasPrefix(in.Link, "mailto:") {
		in.Link = "https://" + in.Link
	}
	if in.Name == "" {
		if pu, err := url.Parse(strings.ReplaceAll(in.Link, "{", "%7B")); err == nil && pu.Host != "" {
			in.Name = strings.TrimPrefix(pu.Host, "www.")
		} else {
			in.Name = in.Link
		}
	}
	k, ok := cleanKeyword(in.Keyword)
	if !ok {
		writeErr(w, http.StatusBadRequest, "keyword: letters, digits and a few symbols, up to 40 characters, no spaces")
		return false
	}
	x.Name, x.Keyword, x.Link, x.Icon, x.OpenWith, x.Folder = in.Name, k, in.Link, strings.TrimSpace(in.Icon), strings.TrimSpace(in.OpenWith), strings.TrimSpace(in.Folder)
	if in.Shared != nil {
		x.Shared = *in.Shared
	}
	if in.Pinned != nil {
		x.Pinned = *in.Pinned
	}
	return true
}

func (s *Server) handleListQuicklinks(w http.ResponseWriter, r *http.Request) {
	list, total, err := s.store.ListQuicklinks(r.Context(), libFilter(r))
	if err != nil {
		s.fail(w, err, "list quicklinks")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"quicklinks": list, "total": total})
}

func (s *Server) handleCreateQuicklink(w http.ResponseWriter, r *http.Request) {
	var in quicklinkIn
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	x := &store.Quicklink{UserID: userFrom(r.Context()).ID}
	if !in.apply(x, w) {
		return
	}
	if err := s.store.CreateQuicklink(r.Context(), x); err != nil {
		if err == store.ErrConflict {
			writeErr(w, http.StatusConflict, "you already have a quicklink with that keyword")
			return
		}
		s.fail(w, err, "create quicklink")
		return
	}
	out, _ := s.store.GetQuicklink(r.Context(), x.UserID, x.ID)
	writeJSON(w, http.StatusCreated, out)
}

func (s *Server) handleGetQuicklink(w http.ResponseWriter, r *http.Request) {
	x, err := s.store.GetQuicklink(r.Context(), userFrom(r.Context()).ID, idParam(r, "id"))
	if err != nil {
		s.fail(w, err, "get quicklink")
		return
	}
	writeJSON(w, http.StatusOK, x)
}

func (s *Server) ownQuicklink(w http.ResponseWriter, r *http.Request) *store.Quicklink {
	u := userFrom(r.Context())
	x, err := s.store.GetQuicklink(r.Context(), u.ID, idParam(r, "id"))
	if err != nil {
		s.fail(w, err, "get quicklink")
		return nil
	}
	if x.UserID != u.ID && u.Role != "admin" {
		writeErr(w, http.StatusForbidden, "only the owner can change a shared quicklink")
		return nil
	}
	return x
}

func (s *Server) handleUpdateQuicklink(w http.ResponseWriter, r *http.Request) {
	x := s.ownQuicklink(w, r)
	if x == nil {
		return
	}
	var in quicklinkIn
	keys, err := decodeKeys(r, &in)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if !keys["name"] || in.Name == "" {
		in.Name = x.Name
	}
	if !keys["link"] {
		in.Link = x.Link
	}
	if !keys["keyword"] {
		in.Keyword = x.Keyword
	}
	if !keys["icon"] {
		in.Icon = x.Icon
	}
	if !keys["open_with"] && !keys["openWith"] {
		in.OpenWith = x.OpenWith
	}
	if !keys["folder"] {
		in.Folder = x.Folder
	}
	if !in.apply(x, w) {
		return
	}
	if err := s.store.UpdateQuicklink(r.Context(), x); err != nil {
		if err == store.ErrConflict {
			writeErr(w, http.StatusConflict, "you already have a quicklink with that keyword")
			return
		}
		s.fail(w, err, "update quicklink")
		return
	}
	out, _ := s.store.GetQuicklink(r.Context(), userFrom(r.Context()).ID, x.ID)
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleDeleteQuicklink(w http.ResponseWriter, r *http.Request) {
	x := s.ownQuicklink(w, r)
	if x == nil {
		return
	}
	if err := s.store.DeleteQuicklink(r.Context(), x.UserID, x.ID); err != nil {
		s.fail(w, err, "delete quicklink")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// resolveLink fills the placeholders of a quicklink; values are percent-encoded.
func resolveLink(link string, args map[string]string, clipboard, selection string) snippet.Result {
	enc := map[string]string{}
	for k, v := range args {
		enc[k] = url.QueryEscape(v)
	}
	return snippet.Expand(link, snippet.Input{Args: enc, Clipboard: url.QueryEscape(clipboard), Selection: url.QueryEscape(selection)})
}

// handleOpenQuicklink resolves the URL (POST {args, clipboard}) and counts the use.
func (s *Server) handleOpenQuicklink(w http.ResponseWriter, r *http.Request) {
	x, err := s.store.GetQuicklink(r.Context(), userFrom(r.Context()).ID, idParam(r, "id"))
	if err != nil {
		s.fail(w, err, "get quicklink")
		return
	}
	var in expandIn
	_ = decode(r, &in)
	res := resolveLink(x.Link, in.Args, in.Clipboard, in.Selection)
	if len(res.Missing) > 0 {
		writeJSON(w, http.StatusOK, map[string]any{"url": "", "missing": res.Missing, "arguments": x.Arguments})
		return
	}
	s.store.UseQuicklink(r.Context(), x.ID)
	writeJSON(w, http.StatusOK, map[string]any{"url": res.Text, "open_with": x.OpenWith})
}

// handleGo redirects /go/<keyword|id>?q=… to the resolved quicklink, so the
// app works as a custom search engine in any browser.
func (s *Server) handleGo(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	key := chi.URLParam(r, "key")
	var x *store.Quicklink
	var err error
	if id, e := strconv.ParseInt(key, 10, 64); e == nil {
		x, err = s.store.GetQuicklink(r.Context(), u.ID, id)
	} else {
		x, err = s.store.GetQuicklinkByKeyword(r.Context(), u.ID, key)
	}
	if err != nil {
		http.Error(w, "no quicklink "+key, http.StatusNotFound)
		return
	}
	args := map[string]string{}
	q := r.URL.Query()
	for k, v := range q {
		if len(v) > 0 {
			args[k] = v[0]
		}
	}
	if v := q.Get("q"); v != "" {
		args["query"] = v
		for _, a := range x.Arguments {
			if _, ok := args[a.Name]; !ok {
				args[a.Name] = v
			}
		}
	}
	res := resolveLink(x.Link, args, "", "")
	s.store.UseQuicklink(r.Context(), x.ID)
	http.Redirect(w, r, res.Text, http.StatusFound)
}
