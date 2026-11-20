package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	core "github.com/abjelosevic88/pocket-homelab-core/sdk"
)

func bearer(tok string) principal {
	return principal{tok, func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+tok) }}
}

// A Pocket Move link reaches exactly the description, the export (GET,
// move:export) and the import (POST, move:import); nothing else.
func TestMoveLinkScopes(t *testing.T) {
	h := newPerUserHarness(t)
	exp, imp, other := bearer("pcx_bob_export"), bearer("pcx_bob_import"), bearer("pcx_bob_read")
	for _, c := range []struct {
		p            principal
		method, path string
		want         int
	}{
		{exp, "GET", core.PortablePath, 200},
		{exp, "GET", "/api/v1/export", 200},
		{exp, "POST", "/api/v1/import", 403},
		{exp, "GET", "/api/v1/clips", 403},
		{exp, "GET", "/api/v1/snippets", 403},
		{exp, "GET", "/api/v1/settings", 403},
		{exp, "GET", "/api/v1/backup", 403},
		{exp, "GET", "/api/v1/tokens", 403},
		{imp, "GET", core.PortablePath, 200},
		{imp, "POST", "/api/v1/import", 200},
		{imp, "GET", "/api/v1/export", 403},
		{imp, "POST", "/api/v1/snippets", 403},
		{imp, "POST", "/api/v1/tokens", 403},
		{imp, "PUT", "/api/v1/settings", 403},
		{other, "GET", core.PortablePath, 403},
		{other, "GET", "/api/v1/export", 403},
	} {
		var body any
		if c.method != "GET" {
			body = map[string]any{"snippets": []any{}, "quicklinks": []any{}}
		}
		if code, out := h.do(c.p, c.method, c.path, body); code != c.want {
			t.Errorf("%s %s %s → %d, want %d (%s)", c.p.name, c.method, c.path, code, c.want, out)
		}
	}
	_, out := h.do(exp, "GET", core.PortablePath, nil)
	var p core.Portable
	if err := json.Unmarshal(out, &p); err != nil || len(p.Exports) != 1 || len(p.Imports) != 1 || p.Exports[0].Kind != core.KindPocket {
		t.Fatalf("portable: %s", out)
	}
}

// Move brings Alice's snippets and quicklinks to Bob: the import adds once,
// and neither sees the other's.
func TestMoveImportAddsOnce(t *testing.T) {
	h := newPerUserHarness(t)
	h.create(h.aliceS, "/api/v1/snippets", map[string]any{"name": "Alice sig", "keyword": "sig", "content": "Alice zebra signature"})
	h.create(h.aliceS, "/api/v1/quicklinks", map[string]any{"name": "Alice search", "keyword": "s", "link": "https://alice.example/?q={Query}"})
	h.create(h.bobS, "/api/v1/snippets", map[string]any{"name": "Bob own", "content": "Bob's own snippet"})

	code, export := h.do(bearer("pcx_alice_export"), "GET", "/api/v1/export", nil)
	if code != 200 || !strings.Contains(string(export), "zebra") || strings.Contains(string(export), "Bob's own") {
		t.Fatalf("alice's export: %d %s", code, export)
	}
	if _, bob := h.do(bearer("pcx_bob_export"), "GET", "/api/v1/export", nil); strings.Contains(string(bob), "zebra") {
		t.Fatalf("bob's export holds alice's data: %s", bob)
	}

	imp := func() map[string]float64 {
		code, out := h.do(bearer("pcx_bob_import"), "POST", "/api/v1/import", bytes.NewBuffer(export))
		if code != 200 {
			t.Fatalf("import: %d %s", code, out)
		}
		var m map[string]float64
		_ = json.Unmarshal(out, &m)
		return m
	}
	if first := imp(); first["snippets"] != 1 || first["quicklinks"] != 1 {
		t.Fatalf("first import: %v", first)
	}
	if second := imp(); second["snippets"]+second["quicklinks"]+second["clips"] != 0 || second["skipped"] != 2 {
		t.Fatalf("second import added: %v", second)
	}

	count := func(p principal, path, key string) int {
		_, out := h.do(p, "GET", path, nil)
		var m map[string]json.RawMessage
		_ = json.Unmarshal(out, &m)
		var l []any
		_ = json.Unmarshal(m[key], &l)
		return len(l)
	}
	if n := count(h.bobS, "/api/v1/snippets", "snippets"); n != 2 {
		t.Fatalf("bob's snippets: %d", n)
	}
	if n := count(h.bobS, "/api/v1/quicklinks", "quicklinks"); n != 1 {
		t.Fatalf("bob's quicklinks: %d", n)
	}
	if n := count(h.aliceS, "/api/v1/snippets", "snippets"); n != 1 {
		t.Fatalf("alice's snippets changed: %d", n)
	}
}
