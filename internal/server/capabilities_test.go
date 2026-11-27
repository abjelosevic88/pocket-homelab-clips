package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	core "github.com/abjelosevic88/pocket-homelab-core/sdk"
)

// linkScopes are the kinds of pcx_<who>_<kind> link tokens Pocket Hub and
// Pocket Search hold here (the fake Core in peruser_test.go answers them).
var linkScopes = map[string]string{
	"search": core.ScopeSearch, "day": core.ScopeDay, "widget": core.ScopeWidget, "capture": core.ScopeCapture,
}

func (h *peruserHarness) count(table string, uid int64) int {
	h.t.Helper()
	var n int
	if err := h.st.DB.QueryRow(`SELECT COUNT(1) FROM `+table+` WHERE user_id = ?`, uid).Scan(&n); err != nil {
		h.t.Fatal(err)
	}
	return n
}

func (h *peruserHarness) decode(p principal, method, path string, body, out any) int {
	h.t.Helper()
	code, raw := h.do(p, method, path, body)
	if out != nil {
		_ = json.Unmarshal(raw, out)
	}
	return code
}

// event waits for an event the app publishes (the outbox sends it within a second or so).
func (fc *fakeCore) event(t *testing.T, topic, subject string) map[string]any {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		fc.mu.Lock()
		for _, e := range fc.events {
			if e["topic"] == topic && e["subject"] == subject {
				fc.mu.Unlock()
				p, _ := e["payload"].(map[string]any)
				return p
			}
		}
		fc.mu.Unlock()
	}
	t.Fatalf("no %s event for %s", topic, subject)
	return nil
}

// Pocket Search finds the person's own snippets by name, keyword, folder and
// text, with the folder and the start of the text as context. Clips (the
// clipboard history) and other people's snippets, shared or not, never show.
func TestPocketSearch(t *testing.T) {
	h := newPerUserHarness(t)
	a := h.aliceS
	sig := h.create(a, "/api/v1/snippets", map[string]any{"name": "Email signature", "keyword": "sig", "folder": "Work", "content": "Best regards,\n  Alice zebra\n\nAcme Ltd, 1 Long Street, Springfield, with a line that runs on and on past what fits on one short line"})
	h.create(a, "/api/v1/snippets", map[string]any{"name": "Address", "content": "1 Long Street zebra"})
	h.create(a, "/api/v1/clips", map[string]any{"content": "zebra password hunter2"})
	h.create(h.bobS, "/api/v1/snippets", map[string]any{"name": "Bob zebra", "content": "Bob's shared zebra", "shared": true})

	var res core.SearchResults
	if code := h.decode(a, "GET", "/api/v1/pocket/search?q=zebra", nil, &res); code != 200 || len(res.Items) != 2 {
		t.Fatalf("search: %d %+v", code, res)
	}
	for _, it := range res.Items {
		if it.Kind != "snippet" || it.URL != "/snippets?edit="+it.ID || it.Date == "" || strings.Contains(it.Title, "Bob") || strings.Contains(it.Snippet, "hunter2") || strings.Contains(it.Snippet, "<mark>") {
			t.Errorf("item %+v", it)
		}
	}
	got := map[string]core.SearchItem{}
	for _, it := range res.Items {
		got[it.Title] = it
	}
	if it := got["Email signature"]; it.ID != idOf(sig) || it.Snippet != "Work · Best regards, Alice zebra Acme Ltd, 1 Long Street, Springfield, with a line tha…" {
		t.Errorf("signature: %+v", it)
	}
	if it := got["Address"]; it.Snippet != "1 Long Street zebra" {
		t.Errorf("address: %+v", it)
	}
	for q, want := range map[string]string{"sig": "Email signature", "work": "Email signature", "regards": "Email signature", "addr": "Address"} {
		res = core.SearchResults{}
		if h.decode(a, "GET", "/api/v1/pocket/search?q="+q, nil, &res); len(res.Items) != 1 || res.Items[0].Title != want {
			t.Errorf("q=%s: %+v", q, res.Items)
		}
	}
	res = core.SearchResults{}
	if h.decode(a, "GET", "/api/v1/pocket/search?q=zebra&limit=1", nil, &res); len(res.Items) != 1 {
		t.Errorf("limit=1 gave %d", len(res.Items))
	}
	for _, q := range []string{"", "%20", "%3F%3F", "*", "hunter2", "password"} {
		var raw map[string]any
		if code := h.decode(a, "GET", "/api/v1/pocket/search?q="+q, nil, &raw); code != 200 {
			t.Errorf("q=%q: %d", q, code)
		}
		if items, ok := raw["items"].([]any); !ok || len(items) != 0 {
			t.Errorf("q=%q: %v", q, raw)
		}
	}
	// Bob finds his own snippet, not Alice's.
	res = core.SearchResults{}
	if h.decode(h.bobS, "GET", "/api/v1/pocket/search?q=zebra", nil, &res); len(res.Items) != 1 || res.Items[0].Title != "Bob zebra" {
		t.Errorf("bob: %+v", res.Items)
	}
	if code, _ := h.do(principal{"nobody", func(*http.Request) {}}, "GET", "/api/v1/pocket/search?q=zebra", nil); code != 401 {
		t.Errorf("without a sign-in: %d", code)
	}
}

// Pocket Hub's widget: pinned snippets first, then the ones used most, then
// the newest; no line, no clips, nobody else's snippets.
func TestPocketWidget(t *testing.T) {
	h := newPerUserHarness(t)
	a := h.aliceS
	h.create(a, "/api/v1/snippets", map[string]any{"name": "Old unused", "content": "x"})
	once := h.create(a, "/api/v1/snippets", map[string]any{"name": "Used once", "folder": "Work", "content": "y"})
	often := h.create(a, "/api/v1/snippets", map[string]any{"name": "Used often", "content": "z"})
	h.create(a, "/api/v1/snippets", map[string]any{"name": "Pinned", "folder": "Home", "content": "p", "pinned": true})
	h.create(a, "/api/v1/snippets", map[string]any{"name": "Newest", "content": "n"})
	h.create(a, "/api/v1/clips", map[string]any{"content": "a copied password"})
	h.create(h.bobS, "/api/v1/snippets", map[string]any{"name": "Bob shared", "content": "b", "shared": true, "pinned": true})
	h.do(a, "POST", "/api/v1/snippets/"+idOf(once)+"/expand", map[string]any{})
	for range 3 {
		h.do(a, "POST", "/api/v1/snippets/"+idOf(often)+"/expand", map[string]any{})
	}

	var wd core.WidgetData
	if code := h.decode(a, "GET", "/api/v1/pocket/widget", nil, &wd); code != 200 {
		t.Fatalf("widget: %d", code)
	}
	if wd.URL != "/snippets" || wd.Line != "" || len(wd.Metrics) != 0 || len(wd.Items) != 5 {
		t.Fatalf("widget: %+v", wd)
	}
	var titles, details []string
	for _, it := range wd.Items {
		titles, details = append(titles, it.Title), append(details, it.Detail)
		if it.ID == "" || it.URL != "/snippets?edit="+it.ID {
			t.Errorf("row %+v", it)
		}
	}
	if got := strings.Join(titles, ", "); got != "Pinned, Used often, Used once, Newest, Old unused" {
		t.Errorf("rows: %s", got)
	}
	if got := strings.Join(details, "|"); got != "Home|used 3 times|Work · used once||" {
		t.Errorf("details: %s", got)
	}

	wd = core.WidgetData{}
	if h.decode(h.bobS, "GET", "/api/v1/pocket/widget", nil, &wd); len(wd.Items) != 1 || wd.Items[0].Title != "Bob shared" {
		t.Errorf("bob's widget: %+v", wd.Items)
	}
	// Someone without snippets gets nothing, even with clips.
	carol := bearer("pcd_carol")
	h.create(carol, "/api/v1/clips", map[string]any{"content": "carol's clip"})
	var raw map[string]any
	if code := h.decode(carol, "GET", "/api/v1/pocket/widget", nil, &raw); code != 200 || raw["line"] != nil || len(raw["items"].([]any)) != 0 {
		t.Errorf("widget without snippets: %d %v", code, raw)
	}
}

// A quick line becomes one new snippet of the person's (named after the title
// or its first words, no folder, no keyword), through the app's own create:
// its event goes out. The clipboard history is never touched, and the same
// request again answers the same snippet.
func TestPocketCapture(t *testing.T) {
	h := newPerUserHarness(t)
	a := h.aliceS
	const path = "/api/v1/pocket/capture"
	clips := h.count("clips", h.alice.ID)

	var res, again core.CaptureResult
	line := map[string]any{"request_id": "req-0000000000000001", "kind": "snippet", "text": "Thanks for your message, I will get back to you tomorrow."}
	if code := h.decode(a, "POST", path, line, &res); code != 201 || res.ID == "" || res.Title != "Thanks for your message, I will" || res.URL != "/snippets?edit="+res.ID {
		t.Fatalf("capture: %d %+v", code, res)
	}
	var x map[string]any
	if h.decode(a, "GET", "/api/v1/snippets/"+res.ID, nil, &x); x["content"] != line["text"] || x["folder"] != "" || x["keyword"] != "" || x["shared"] != false || x["pinned"] != false {
		t.Errorf("the snippet: %v", x)
	}
	if ev := h.core.event(t, "clips.snippet_created", "snippet:"+res.ID); ev["user_email"] != "alice@example.com" || jsonNum(ev["snippet_id"]) != res.ID {
		t.Errorf("event: %v", ev)
	}
	// Sent again (the answer was lost on the way): the same snippet, nothing new.
	if code := h.decode(a, "POST", path, line, &again); code != 201 || again != res {
		t.Errorf("same request again: %d %+v, want %+v", code, again, res)
	}
	if n := h.count("snippets", h.alice.ID); n != 1 {
		t.Errorf("alice has %d snippets after the same request twice", n)
	}
	// The id is the person's own: Bob using the same one gets his own snippet.
	var bobs core.CaptureResult
	if code := h.decode(h.bobS, "POST", path, line, &bobs); code != 201 || bobs.ID == res.ID {
		t.Errorf("bob with the same request id: %d %+v", code, bobs)
	}
	if code, _ := h.do(h.bobS, "GET", "/api/v1/snippets/"+res.ID, nil); code != 404 {
		t.Errorf("bob reads alice's captured snippet: %d", code)
	}

	// With a title: it names the snippet; a title alone is also its text. No kind = the first one.
	var titled, only core.CaptureResult
	if code := h.decode(a, "POST", path, map[string]any{"request_id": "req-0000000000000002", "title": "  Bank   details ", "text": "IBAN BA39 1234"}, &titled); code != 201 || titled.Title != "Bank details" {
		t.Fatalf("with a title: %d %+v", code, titled)
	}
	x = nil
	if h.decode(a, "GET", "/api/v1/snippets/"+titled.ID, nil, &x); x["name"] != "Bank details" || x["content"] != "IBAN BA39 1234" {
		t.Errorf("titled: %v", x)
	}
	h.decode(a, "POST", path, map[string]any{"request_id": "req-0000000000000003", "title": "See you soon"}, &only)
	x = nil
	if h.decode(a, "GET", "/api/v1/snippets/"+only.ID, nil, &x); x["name"] != "See you soon" || x["content"] != "See you soon" {
		t.Errorf("title only: %v", x)
	}

	before := h.count("snippets", h.alice.ID)
	for name, body := range map[string]map[string]any{
		"nothing to keep":            {"request_id": "req-0000000000000004", "title": " ", "text": "\n "},
		"no request id":              {"text": "x"},
		"a short request id":         {"request_id": "short", "text": "x"},
		"a kind the app has not got": {"request_id": "req-0000000000000005", "kind": "clip", "text": "x"},
		"a used id, other words":     {"request_id": "req-0000000000000001", "kind": "snippet", "text": "Something else"},
	} {
		var e struct{ Error string }
		if code := h.decode(a, "POST", path, body, &e); code != 400 || e.Error == "" {
			t.Errorf("%s: %d %q, want 400", name, code, e.Error)
		}
	}
	if code, _ := h.do(a, "POST", path, "not json"); code != 400 {
		t.Errorf("not json: %d", code)
	}
	if n := h.count("snippets", h.alice.ID); n != before {
		t.Errorf("refused captures made %d snippets", n-before)
	}
	if n := h.count("clips", h.alice.ID); n != clips {
		t.Errorf("captures touched the clipboard history: %d clips, had %d", n, clips)
	}
}

// Two of the same request at once still make one snippet.
func TestPocketCaptureAtOnce(t *testing.T) {
	h := newPerUserHarness(t)
	line := map[string]any{"request_id": "req-at-once-00000001", "text": "Only once"}
	ids := make([]string, 6)
	var wg sync.WaitGroup
	for i := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var out core.CaptureResult
			code, raw := h.do(h.aliceS, "POST", "/api/v1/pocket/capture", line)
			if code == 201 {
				_ = json.Unmarshal(raw, &out)
			}
			ids[i] = out.ID
		}()
	}
	wg.Wait()
	for _, id := range ids {
		if id == "" || id != ids[0] {
			t.Fatalf("answers differ: %v", ids)
		}
	}
	if n := h.count("snippets", h.alice.ID); n != 1 {
		t.Errorf("%d snippets from one request sent six times", n)
	}
}

// A link token with one of the pocket:* scopes reaches exactly its route (and
// who it acts for); the app's own API, the clipboard history included, stays
// closed to it, and Pocket Move's scopes do not open these routes.
func TestPocketLinkScopes(t *testing.T) {
	h := newPerUserHarness(t)
	h.create(h.aliceS, "/api/v1/snippets", map[string]any{"name": "Signature", "content": "Best regards"})
	h.create(h.aliceS, "/api/v1/clips", map[string]any{"content": "Best password"})

	line := func(id string) map[string]any {
		return map[string]any{"request_id": id, "kind": "snippet", "text": "From the hub " + id[len(id)-1:]}
	}
	routes := []struct {
		scope, method, path string
		body                any
		want                int
	}{
		{"search", "GET", "/api/v1/pocket/search?q=best", nil, 200},
		{"widget", "GET", "/api/v1/pocket/widget", nil, 200},
		{"capture", "POST", "/api/v1/pocket/capture", line("req-link-000000000001"), 201},
	}
	for _, kind := range []string{"search", "day", "widget", "capture", "read", "export", "import"} {
		for _, rt := range routes {
			want := http.StatusForbidden
			if kind == rt.scope {
				want = rt.want
			}
			if code, out := h.do(bearer("pcx_alice_"+kind), rt.method, rt.path, rt.body); code != want {
				t.Errorf("%s %s with %s: %d, want %d (%s)", rt.method, rt.path, kind, code, want, out)
			}
		}
	}
	for _, kind := range []string{"search", "day", "widget", "capture"} {
		p := bearer("pcx_alice_" + kind)
		for _, c := range []struct{ method, path string }{
			{"GET", "/api/v1/clips"}, {"GET", "/api/v1/clips?q=best"}, {"POST", "/api/v1/clips"}, {"GET", "/api/v1/search?q=best"},
			{"GET", "/api/v1/snippets"}, {"POST", "/api/v1/snippets"}, {"GET", "/api/v1/snippets/expand?keyword=sig"},
			{"GET", "/api/v1/quicklinks"}, {"GET", "/api/v1/dashboard"}, {"GET", "/api/v1/settings"}, {"GET", "/api/v1/export"},
			{"GET", core.PortablePath},
		} {
			if code, _ := h.do(p, c.method, c.path, map[string]any{"content": "x", "name": "x"}); code != http.StatusForbidden {
				t.Errorf("%s %s with %s: %d, want 403", c.method, c.path, kind, code)
			}
		}
		var who struct{ Email string }
		if code := h.decode(p, "GET", "/api/v1/auth/me", nil, &who); code != 200 || who.Email != "alice@example.com" {
			t.Errorf("auth/me with %s: %d %q", kind, code, who.Email)
		}
	}
	// No day feed: the day route is not there for anyone.
	if code, out := h.do(h.aliceS, "GET", "/api/v1/pocket/day/"+time.Now().Format("2006-01-02"), nil); code == 200 && strings.Contains(string(out), `"items"`) {
		t.Errorf("day route answered: %s", out)
	}

	// The link acts for one person, and finds snippets, never clips.
	var res core.SearchResults
	if h.decode(bearer("pcx_alice_search"), "GET", "/api/v1/pocket/search?q=best", nil, &res); len(res.Items) != 1 || res.Items[0].Title != "Signature" {
		t.Errorf("alice through the link: %+v", res.Items)
	}
	res = core.SearchResults{}
	if h.decode(bearer("pcx_bob_search"), "GET", "/api/v1/pocket/search?q=best", nil, &res); len(res.Items) != 0 {
		t.Errorf("bob through the link: %+v", res.Items)
	}

	// A line kept through the link: one snippet however often it is sent, Alice's.
	var kept, again core.CaptureResult
	h.decode(bearer("pcx_alice_capture"), "POST", "/api/v1/pocket/capture", line("req-link-000000000002"), &kept)
	if code := h.decode(bearer("pcx_alice_capture"), "POST", "/api/v1/pocket/capture", line("req-link-000000000002"), &again); code != 201 || kept.ID == "" || again != kept {
		t.Fatalf("capture through the link twice: %d %+v then %+v", code, kept, again)
	}
	if a, b := h.count("snippets", h.alice.ID), h.count("snippets", h.bob.ID); a != 3 || b != 0 {
		t.Errorf("snippets: alice %d (want 3), bob %d", a, b)
	}
	if n := h.count("clips", h.alice.ID); n != 1 {
		t.Errorf("alice has %d clips", n)
	}
	// The same id sent by the person themself is another request: ids are kept per app.
	var own core.CaptureResult
	if h.decode(h.aliceS, "POST", "/api/v1/pocket/capture", line("req-link-000000000002"), &own); own.ID == "" || own.ID == kept.ID {
		t.Errorf("the person's own capture with an app's request id: %+v", own)
	}
}

// What Core is told: search, widget and capture (no day), their offers next
// to Pocket Move's, and the shelf the app sits on.
func TestManifestCapabilities(t *testing.T) {
	h := newPerUserHarness(t)
	h.cfg.CoreRegistrationKey, h.cfg.CoreAppURL = "pcr_test", "http://clips:8080"
	if err := h.s.registerWithCore(context.Background()); err != nil {
		t.Fatal(err)
	}
	h.core.mu.Lock()
	raw, _ := json.Marshal(h.core.manifest)
	h.core.mu.Unlock()
	var m core.Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	if m.Slug != "clips" || m.Category != "Tools" {
		t.Errorf("manifest %q on shelf %q", m.Slug, m.Category)
	}
	if m.Search == nil || strings.Join(m.Search.Bangs, ",") != "clips,snippet" || strings.Join(m.Search.Kinds, ",") != "snippet" || m.Search.What == "" {
		t.Errorf("search: %+v", m.Search)
	}
	if m.Day != nil {
		t.Errorf("day: %+v", m.Day)
	}
	if m.Widget == nil || m.Widget.Title != "Snippets" || m.Widget.What == "" {
		t.Errorf("widget: %+v", m.Widget)
	}
	if m.Capture == nil || len(m.Capture.Kinds) != 1 || m.Capture.Kinds[0].Kind != "snippet" || strings.Join(m.Capture.Kinds[0].Fields, ",") != "title" {
		t.Errorf("capture: %+v", m.Capture)
	}
	offers := map[string]bool{}
	for _, o := range m.Offers {
		if o.Name == "" || o.Description == "" {
			t.Errorf("offer %q has no words", o.Scope)
		}
		offers[o.Scope] = true
	}
	for _, scope := range []string{core.ScopeSearch, core.ScopeWidget, core.ScopeCapture, core.ScopeMoveExport, core.ScopeMoveImport} {
		if !offers[scope] {
			t.Errorf("no offer for %s: %+v", scope, m.Offers)
		}
	}
	if offers[core.ScopeDay] {
		t.Errorf("offers %s without a day feed", core.ScopeDay)
	}
}
