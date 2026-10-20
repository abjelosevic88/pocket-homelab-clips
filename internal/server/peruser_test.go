package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/abjelosevic88/pocket-homelab-clips/internal/config"
	"github.com/abjelosevic88/pocket-homelab-clips/internal/store"
)

// fakeCore answers token introspection (pcd_<who> → <who>@example.com) and
// records published events.
type fakeCore struct {
	*httptest.Server
	mu     sync.Mutex
	events []map[string]any
}

func newFakeCore(t *testing.T) *fakeCore {
	fc := &fakeCore{}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/auth/introspect", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Token string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		who := strings.TrimPrefix(in.Token, "pcd_")
		if who == in.Token || who == "revoked" {
			_ = json.NewEncoder(w).Encode(map[string]any{"active": false})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"active": true, "kind": "device", "user": map[string]any{"id": 1, "sub": who, "email": who + "@example.com", "name": who}})
	})
	mux.HandleFunc("/api/v1/events", func(w http.ResponseWriter, r *http.Request) {
		var e map[string]any
		_ = json.NewDecoder(r.Body).Decode(&e)
		fc.mu.Lock()
		fc.events = append(fc.events, e)
		fc.mu.Unlock()
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{}`))
	})
	fc.Server = httptest.NewServer(mux)
	t.Cleanup(fc.Close)
	return fc
}

// principal is one way of calling the API as a given user.
type principal struct {
	name   string
	header func(r *http.Request)
}

type peruserHarness struct {
	t      *testing.T
	ts     *httptest.Server
	st     *store.Store
	cfg    *config.Config
	core   *fakeCore
	alice  *store.User // the owner (admin)
	bob    *store.User // a household member
	as     map[string][]principal
	aliceS principal
	bobS   principal
}

func newPerUserHarness(t *testing.T) *peruserHarness {
	t.Helper()
	dir := t.TempDir()
	fc := newFakeCore(t)
	cfg := &config.Config{DataDir: dir, DBPath: filepath.Join(dir, "t.db"), ImagesDir: filepath.Join(dir, "images"), AuthMode: "local",
		SessionTTL: time.Hour, MaxClipBytes: 1 << 20, MaxImageBytes: 1 << 20, CoreURL: fc.URL}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	st, err := store.Open(cfg.DBPath, log)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	_ = os.MkdirAll(cfg.ImagesDir, 0o755)
	s := New(cfg, st, log, nil)
	if err := s.core.Start(t.Context()); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s.Router())
	t.Cleanup(ts.Close)

	ctx := context.Background()
	alice := &store.User{Email: "alice@example.com", Name: "Alice", Role: "admin"}
	bob := &store.User{Email: "bob@example.com", Name: "Bob", Role: "member"}
	for _, u := range []*store.User{alice, bob} {
		if err := st.CreateUser(ctx, u); err != nil {
			t.Fatal(err)
		}
	}
	h := &peruserHarness{t: t, ts: ts, st: st, cfg: cfg, core: fc, alice: alice, bob: bob, as: map[string][]principal{}}
	for _, u := range []*store.User{alice, bob} {
		who := strings.Split(u.Email, "@")[0]
		sid, _ := st.CreateSession(ctx, u.ID, time.Hour)
		tok, _, _ := st.CreateAPIToken(ctx, u.ID, "laptop")
		ps := []principal{
			{who + "/session", func(r *http.Request) { r.AddCookie(&http.Cookie{Name: sessionCookie, Value: sid}) }},
			{who + "/api-token", func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+tok) }},
			{who + "/x-api-key", func(r *http.Request) { r.Header.Set("X-API-Key", tok) }},
			{who + "/core-device", func(r *http.Request) { r.Header.Set("Authorization", "Bearer pcd_"+who) }},
		}
		h.as[who] = ps
	}
	h.aliceS, h.bobS = h.as["alice"][0], h.as["bob"][0]
	return h
}

func (h *peruserHarness) do(p principal, method, path string, body any) (int, []byte) {
	h.t.Helper()
	var rd io.Reader
	ct := ""
	switch b := body.(type) {
	case nil:
	case string:
		rd, ct = strings.NewReader(b), "text/plain"
	case *bytes.Buffer:
		rd = b
	default:
		buf, _ := json.Marshal(b)
		rd, ct = bytes.NewReader(buf), "application/json"
	}
	req, _ := http.NewRequest(method, h.ts.URL+path, rd)
	if ct != "" {
		req.Header.Set("Content-Type", ct)
	}
	p.header(req)
	cl := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := cl.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(res.Body)
	return res.StatusCode, out
}

func (h *peruserHarness) create(p principal, path string, body any) map[string]any {
	h.t.Helper()
	code, out := h.do(p, http.MethodPost, path, body)
	if code != http.StatusCreated && code != http.StatusOK {
		h.t.Fatalf("POST %s as %s: %d %s", path, p.name, code, out)
	}
	var m map[string]any
	_ = json.Unmarshal(out, &m)
	return m
}

var queryEcho = regexp.MustCompile(`"q":"[^"]*"`)

func idOf(m map[string]any) string { return jsonNum(m["id"]) }

func jsonNum(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// TestPerUserIsolation: Bob, over every way he can authenticate, can neither
// list, read, search, update, delete, expand, open nor export anything Alice
// owns. Unknown and foreign ids both answer 404.
func TestPerUserIsolation(t *testing.T) {
	h := newPerUserHarness(t)
	a := h.aliceS
	clip := h.create(a, "/api/v1/clips", map[string]any{"content": "alice-secret-clip zebra", "source_app": "Notes"})
	link := h.create(a, "/api/v1/clips", map[string]any{"content": "https://alice.example/private"})
	snip := h.create(a, "/api/v1/snippets", map[string]any{"name": "Alice sig zebra", "keyword": "sig", "content": "Alice private zebra text"})
	ql := h.create(a, "/api/v1/quicklinks", map[string]any{"name": "Alice search zebra", "keyword": "s", "link": "https://alice.example/?q={Query}"})
	ids := map[string]string{"clip": idOf(clip), "link": idOf(link), "snippet": idOf(snip), "quicklink": idOf(ql)}

	for _, b := range h.as["bob"] {
		t.Run(b.name, func(t *testing.T) {
			leak := func(path string, out []byte) {
				t.Helper()
				out = queryEcho.ReplaceAll(out, nil) // /search echoes q back
				if bytes.Contains(bytes.ToLower(out), []byte("alice")) || bytes.Contains(out, []byte("zebra")) {
					t.Errorf("%s leaks Alice's data: %s", path, out)
				}
			}
			// listings, search, dashboard, folders, export: nothing of Alice's
			for _, path := range []string{
				"/api/v1/clips", "/api/v1/clips?q=zebra", "/api/v1/clips?kind=link",
				"/api/v1/snippets", "/api/v1/snippets?q=zebra", "/api/v1/snippets?keyword=sig",
				"/api/v1/quicklinks", "/api/v1/quicklinks?q=zebra",
				"/api/v1/search?q=zebra", "/api/v1/search?q=", "/api/v1/search?q=alice",
				"/api/v1/dashboard", "/api/v1/folders",
				"/api/v1/export", "/api/v1/export?clips=1", "/api/v1/export?what=clips",
				"/api/v1/export?what=snippets&bare=1", "/api/v1/export?what=quicklinks&bare=1",
				"/api/v1/settings/system",
			} {
				code, out := h.do(b, http.MethodGet, path, nil)
				if code != http.StatusOK {
					t.Errorf("GET %s: %d %s", path, code, out)
				}
				leak(path, out)
			}
			// direct reads and writes by id: 404, never 403
			probes := []struct{ method, path string }{
				{"GET", "/api/v1/clips/" + ids["clip"]},
				{"GET", "/api/v1/clips/" + ids["clip"] + "/raw"},
				{"GET", "/api/v1/clips/" + ids["clip"] + "/image"},
				{"PUT", "/api/v1/clips/" + ids["clip"]},
				{"POST", "/api/v1/clips/" + ids["clip"] + "/touch"},
				{"DELETE", "/api/v1/clips/" + ids["link"]},
				{"GET", "/api/v1/snippets/" + ids["snippet"]},
				{"PUT", "/api/v1/snippets/" + ids["snippet"]},
				{"DELETE", "/api/v1/snippets/" + ids["snippet"]},
				{"POST", "/api/v1/snippets/" + ids["snippet"] + "/expand"},
				{"GET", "/api/v1/snippets/expand?keyword=sig"},
				{"GET", "/api/v1/snippets/expand?id=" + ids["snippet"]},
				{"GET", "/api/v1/snippets/expand?name=Alice%20sig%20zebra"},
				{"GET", "/api/v1/quicklinks/" + ids["quicklink"]},
				{"PUT", "/api/v1/quicklinks/" + ids["quicklink"]},
				{"DELETE", "/api/v1/quicklinks/" + ids["quicklink"]},
				{"POST", "/api/v1/quicklinks/" + ids["quicklink"] + "/open"},
				{"GET", "/go/s?q=x"},
				{"GET", "/go/" + ids["quicklink"] + "?q=x"},
				{"GET", "/api/v1/clips/999999"},
			}
			for _, p := range probes {
				var body any
				if p.method == "PUT" {
					body = map[string]any{"title": "pwned", "name": "pwned", "content": "pwned", "link": "https://evil.example", "pinned": true}
				}
				code, out := h.do(b, p.method, p.path, body)
				if code != http.StatusNotFound {
					t.Errorf("%s %s: %d (want 404) %s", p.method, p.path, code, out)
				}
				leak(p.path, out)
			}
			// clearing his history leaves Alice's alone
			if code, _ := h.do(b, http.MethodDelete, "/api/v1/clips?pinned=1", nil); code != http.StatusOK {
				t.Errorf("clear: %d", code)
			}
			// box-level endpoints are admin-only
			admin := []struct{ method, path string }{{"GET", "/api/v1/backup"}, {"PUT", "/api/v1/settings"}}
			for _, p := range admin {
				if code, _ := h.do(b, p.method, p.path, map[string]any{"title": "x"}); code != http.StatusForbidden {
					t.Errorf("%s %s as member: %d (want 403)", p.method, p.path, code)
				}
			}
		})
	}

	// Alice's rows are intact and untouched (no title change, no use counts).
	code, out := h.do(a, http.MethodGet, "/api/v1/export?clips=1", nil)
	var ex Export
	_ = json.Unmarshal(out, &ex)
	if code != 200 || len(ex.Clips) != 2 || len(ex.Snippets) != 1 || len(ex.Quicklinks) != 1 {
		t.Fatalf("alice's export: %d clips=%d snippets=%d quicklinks=%d", code, len(ex.Clips), len(ex.Snippets), len(ex.Quicklinks))
	}
	for _, c := range ex.Clips {
		if c.Title == "pwned" || c.Pinned {
			t.Errorf("bob changed alice's clip: %+v", c)
		}
	}
	sn, _ := h.st.GetSnippet(context.Background(), h.alice.ID, mustInt(ids["snippet"]))
	if sn.Content != "Alice private zebra text" || sn.UseCount != 0 {
		t.Errorf("alice's snippet changed: %+v", sn)
	}
	// and every one of Alice's paths still sees her own data
	for _, p := range h.as["alice"] {
		code, out := h.do(p, http.MethodGet, "/api/v1/search?q=zebra", nil)
		if code != 200 || !bytes.Contains(out, []byte("alice-secret-clip")) || !bytes.Contains(out, []byte("Alice sig zebra")) {
			t.Errorf("alice via %s: %d %s", p.name, code, out)
		}
	}
	// a revoked device token gets nothing
	if code, _ := h.do(principal{"revoked", func(r *http.Request) { r.Header.Set("Authorization", "Bearer pcd_revoked") }}, "GET", "/api/v1/clips", nil); code != http.StatusUnauthorized {
		t.Errorf("revoked device token: %d", code)
	}
}

func mustInt(s string) int64 {
	var n int64
	_ = json.Unmarshal([]byte(s), &n)
	return n
}

// TestPerUserKeywordsAndGo: keywords are unique per person, /go/<kw> and
// snippet expansion resolve to the caller's own item, and an item becomes
// visible to others only when its owner explicitly shares it, read-only.
func TestPerUserKeywordsAndGo(t *testing.T) {
	h := newPerUserHarness(t)
	a, b := h.aliceS, h.bobS
	h.create(a, "/api/v1/quicklinks", map[string]any{"name": "A", "keyword": "g", "link": "https://alice.example/?q={Query}"})
	h.create(b, "/api/v1/quicklinks", map[string]any{"name": "B", "keyword": "g", "link": "https://bob.example/?q={Query}"})
	if code, _ := h.do(a, "POST", "/api/v1/quicklinks", map[string]any{"name": "A2", "keyword": "g", "link": "https://x.example"}); code != http.StatusConflict {
		t.Errorf("duplicate keyword for the same user: %d", code)
	}
	for who, p := range map[string]principal{"alice": a, "bob": b} {
		code, _ := h.do(p, "GET", "/go/g?q=hi", nil)
		req, _ := http.NewRequest("GET", h.ts.URL+"/go/g?q=hi", nil)
		p.header(req)
		res, _ := (&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
		res.Body.Close()
		if code != http.StatusFound || !strings.HasPrefix(res.Header.Get("Location"), "https://"+who+".example/") {
			t.Errorf("/go/g for %s → %d %s", who, code, res.Header.Get("Location"))
		}
	}
	// a numeric keyword is resolved as a keyword, not as someone's id
	alicesOnly := h.create(a, "/api/v1/quicklinks", map[string]any{"name": "A3", "link": "https://alice.example/three"})
	h.create(b, "/api/v1/quicklinks", map[string]any{"name": "B num", "keyword": idOf(alicesOnly), "link": "https://bob.example/num"})
	req, _ := http.NewRequest("GET", h.ts.URL+"/go/"+idOf(alicesOnly), nil)
	b.header(req)
	res, _ := (&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
	res.Body.Close()
	if loc := res.Header.Get("Location"); loc != "https://bob.example/num" {
		t.Errorf("numeric keyword → %q", loc)
	}

	// snippets: same keyword per user, each expands their own
	h.create(a, "/api/v1/snippets", map[string]any{"name": "sig", "keyword": "sig", "content": "Alice signature"})
	h.create(b, "/api/v1/snippets", map[string]any{"name": "sig", "keyword": "sig", "content": "Bob signature"})
	if _, out := h.do(b, "GET", "/api/v1/snippets/expand?keyword=sig", nil); string(out) != "Bob signature" {
		t.Errorf("bob expands %q", out)
	}
	if _, out := h.do(b, "POST", "/api/v1/snippets/expand", map[string]any{"name": "SIG"}); !bytes.Contains(out, []byte("Bob signature")) {
		t.Errorf("bob expands by name %s", out)
	}

	// explicit sharing: visible to Bob, read-only, even to an admin who doesn't own it
	shared := h.create(a, "/api/v1/snippets", map[string]any{"name": "Team shrug", "keyword": "shrug", "content": "shrug!", "shared": true})
	if _, out := h.do(b, "GET", "/api/v1/snippets/expand?keyword=shrug", nil); string(out) != "shrug!" {
		t.Errorf("shared snippet not usable: %q", out)
	}
	if code, _ := h.do(b, "PUT", "/api/v1/snippets/"+idOf(shared), map[string]any{"content": "x"}); code != http.StatusForbidden {
		t.Errorf("member edits a shared snippet: %d", code)
	}
	if code, _ := h.do(b, "DELETE", "/api/v1/snippets/"+idOf(shared), nil); code != http.StatusForbidden {
		t.Errorf("member deletes a shared snippet: %d", code)
	}
	bobShared := h.create(b, "/api/v1/snippets", map[string]any{"name": "Bob shared", "content": "bob's", "shared": true})
	if code, _ := h.do(a, "PUT", "/api/v1/snippets/"+idOf(bobShared), map[string]any{"content": "admin was here"}); code != http.StatusForbidden {
		t.Errorf("admin edits a member's shared snippet: %d", code)
	}
	if code, _ := h.do(a, "DELETE", "/api/v1/snippets/"+idOf(bobShared), nil); code != http.StatusForbidden {
		t.Errorf("admin deletes a member's shared snippet: %d", code)
	}
	if x, _ := h.st.GetSnippet(context.Background(), h.alice.ID, mustInt(idOf(shared))); x.UseCount != 0 {
		t.Errorf("bob's use was counted on alice's row: %d", x.UseCount)
	}
	// Bob's export holds only his own items, never the shared ones
	_, out := h.do(b, "GET", "/api/v1/export", nil)
	if bytes.Contains(out, []byte("shrug")) || bytes.Contains(out, []byte("Alice")) {
		t.Errorf("bob's export includes alice's shared items: %s", out)
	}
	// unsharing hides it again
	h.do(a, "PUT", "/api/v1/snippets/"+idOf(shared), map[string]any{"shared": false})
	if code, _ := h.do(b, "GET", "/api/v1/snippets/"+idOf(shared), nil); code != http.StatusNotFound {
		t.Errorf("unshared snippet still visible: %d", code)
	}
}

// TestPerUserImportAndImages: an import lands in the importer's library only
// (ownership is never taken from the body), and deleting your copy of an image
// never removes the file behind someone else's identical clip.
func TestPerUserImportAndImages(t *testing.T) {
	h := newPerUserHarness(t)
	a, b := h.aliceS, h.bobS
	code, out := h.do(b, "POST", "/api/v1/import", map[string]any{
		"snippets":   []map[string]any{{"name": "Imported", "text": "bob import", "keyword": "imp", "user_id": h.alice.ID}},
		"quicklinks": []map[string]any{{"name": "Imp", "link": "https://bob.example/imp", "user_id": h.alice.ID}},
		"clips":      []map[string]any{{"kind": "text", "content": "bob imported clip", "user_id": h.alice.ID}},
	})
	if code != 200 {
		t.Fatalf("import: %d %s", code, out)
	}
	for _, path := range []string{"/api/v1/snippets", "/api/v1/quicklinks", "/api/v1/clips"} {
		if _, out := h.do(a, "GET", path, nil); bytes.Contains(out, []byte("imp")) || bytes.Contains(out, []byte("bob")) {
			t.Errorf("import leaked into alice's %s: %s", path, out)
		}
		if _, out := h.do(b, "GET", path, nil); !bytes.Contains(bytes.ToLower(out), []byte("imp")) {
			t.Errorf("import missing from bob's %s: %s", path, out)
		}
	}

	// the same picture copied by both
	png := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 13, 'I', 'H', 'D', 'R', 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde}
	upload := func(p principal) map[string]any {
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		fw, _ := mw.CreateFormFile("file", "pic.png")
		_, _ = fw.Write(png)
		_ = mw.Close()
		req, _ := http.NewRequest("POST", h.ts.URL+"/api/v1/clips", &buf)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		p.header(req)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var m map[string]any
		_ = json.NewDecoder(res.Body).Decode(&m)
		if res.StatusCode != http.StatusCreated {
			t.Fatalf("upload as %s: %d %v", p.name, res.StatusCode, m)
		}
		return m
	}
	ai, bi := upload(a), upload(b)
	if ai["content"] != bi["content"] {
		t.Fatalf("expected one shared file name, got %v / %v", ai["content"], bi["content"])
	}
	if code, _ := h.do(b, "DELETE", "/api/v1/clips/"+idOf(bi), nil); code != http.StatusNoContent {
		t.Fatalf("bob deletes his image: %d", code)
	}
	if code, _ := h.do(a, "GET", "/api/v1/clips/"+idOf(ai)+"/image", nil); code != http.StatusOK {
		t.Errorf("alice's image is gone after bob deleted his copy: %d", code)
	}
	if code, _ := h.do(a, "DELETE", "/api/v1/clips/"+idOf(ai), nil); code != http.StatusNoContent {
		t.Fatalf("alice deletes her image: %d", code)
	}
	if _, err := os.Stat(filepath.Join(h.cfg.ImagesDir, ai["content"].(string))); !os.IsNotExist(err) {
		t.Errorf("last reference gone but file kept: %v", err)
	}
}

// TestPerUserCoreEvents: events on the box-wide Core bus name their owner and
// carry no clip, snippet or quicklink text.
func TestPerUserCoreEvents(t *testing.T) {
	h := newPerUserHarness(t)
	b := h.as["bob"][3] // via a paired-phone token
	h.create(b, "/api/v1/clips", map[string]any{"content": "bob-private-text", "title": "Bob private title"})
	h.create(b, "/api/v1/snippets", map[string]any{"name": "Bob private name", "keyword": "bobkw", "content": "bob-private-text"})
	h.create(b, "/api/v1/quicklinks", map[string]any{"name": "Bob private name", "keyword": "bobkw", "link": "https://bob.example/private"})
	deadline := time.Now().Add(3 * time.Second)
	for {
		h.core.mu.Lock()
		n := len(h.core.events)
		h.core.mu.Unlock()
		if n >= 3 || time.Now().After(deadline) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	h.core.mu.Lock()
	defer h.core.mu.Unlock()
	if len(h.core.events) != 3 {
		t.Fatalf("events published: %d", len(h.core.events))
	}
	for _, e := range h.core.events {
		raw, _ := json.Marshal(e)
		if bytes.Contains(raw, []byte("private")) || bytes.Contains(raw, []byte("bobkw")) {
			t.Errorf("event carries content: %s", raw)
		}
		p, _ := e["payload"].(map[string]any)
		if p["user_email"] != "bob@example.com" || jsonNum(p["user_id"]) != jsonNum(h.bob.ID) {
			t.Errorf("event owner: %s", raw)
		}
	}
}
