package store

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
)

func open(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "t.db"), slog.New(slog.NewTextHandler(os.Stderr, nil)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestClipsDedupeAndSearch(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	u := &User{Email: "a@b", Role: "admin"}
	if err := s.CreateUser(ctx, u); err != nil {
		t.Fatal(err)
	}
	c := &Clip{UserID: u.ID, Kind: "text", Content: "Invoice number 2026-001 for Example GmbH"}
	if created, err := s.AddClip(ctx, c); err != nil || !created {
		t.Fatalf("first add: %v %v", created, err)
	}
	if created, err := s.AddClip(ctx, &Clip{UserID: u.ID, Kind: "text", Content: "Invoice number 2026-001 for Example GmbH\n"}); err != nil || created {
		t.Fatalf("dedupe: created=%v err=%v", created, err)
	}
	_, _ = s.AddClip(ctx, &Clip{UserID: u.ID, Kind: "color", Content: "#ff8800"})
	_, _ = s.AddClip(ctx, &Clip{UserID: u.ID, Kind: "link", Content: "https://example.com/x", Title: "Example Domain"})
	got, err := s.GetClip(ctx, u.ID, c.ID)
	if err != nil || got.CopyCount != 2 {
		t.Fatalf("copy_count = %d, err %v", got.CopyCount, err)
	}
	cases := map[string]int{"inv num": 1, "exampl": 2, "ample": 2, "#ff": 1, "#": 1, "nothing-here": 0, "GMBH": 1, "": 3}
	for q, want := range cases {
		list, total, err := s.ListClips(ctx, ClipFilter{UserID: u.ID, Query: q})
		if err != nil {
			t.Fatalf("%q: %v", q, err)
		}
		if total != want || len(list) != want {
			t.Errorf("search %q: got %d/%d, want %d", q, len(list), total, want)
		}
	}
	list, _, _ := s.ListClips(ctx, ClipFilter{UserID: u.ID, Query: "invoice"})
	if list[0].Snippet == "" {
		t.Errorf("expected a highlighted snippet, got none")
	}
	// another user sees nothing
	u2 := &User{Email: "c@d", Role: "member"}
	_ = s.CreateUser(ctx, u2)
	if _, total, _ := s.ListClips(ctx, ClipFilter{UserID: u2.ID}); total != 0 {
		t.Errorf("isolation broken: %d", total)
	}
}

func TestPurge(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	u := &User{Email: "a@b", Role: "admin"}
	_ = s.CreateUser(ctx, u)
	for i := 0; i < 5; i++ {
		_, _ = s.AddClip(ctx, &Clip{UserID: u.ID, Kind: "text", Content: string(rune('a' + i))})
	}
	first, _ := s.GetClip(ctx, u.ID, 1)
	first.Pinned = true
	_ = s.UpdateClip(ctx, first)
	n, _, err := s.PurgeClips(ctx, 0, 2)
	if err != nil || n != 3 {
		t.Fatalf("purge removed %d (%v), want 3", n, err)
	}
	_, total, _ := s.ListClips(ctx, ClipFilter{UserID: u.ID})
	if total != 2 {
		t.Errorf("left %d, want 2", total)
	}
	if _, err := s.GetClip(ctx, u.ID, 1); err != nil {
		t.Errorf("pinned clip was purged")
	}
}

func TestSnippetsSharing(t *testing.T) {
	s := open(t)
	ctx := context.Background()
	a, b := &User{Email: "a@b"}, &User{Email: "c@d"}
	_ = s.CreateUser(ctx, a)
	_ = s.CreateUser(ctx, b)
	_ = s.CreateSnippet(ctx, &Snippet{UserID: a.ID, Name: "Private", Keyword: "p", Content: "x"})
	_ = s.CreateSnippet(ctx, &Snippet{UserID: a.ID, Name: "Shared sig", Keyword: "sig", Content: "{argument name=\"who\"} {date}", Shared: true})
	if err := s.CreateSnippet(ctx, &Snippet{UserID: a.ID, Name: "Dup keyword", Keyword: "sig", Content: "y"}); err != ErrConflict {
		t.Errorf("expected conflict, got %v", err)
	}
	if err := s.CreateSnippet(ctx, &Snippet{UserID: b.ID, Name: "B's sig", Keyword: "sig", Content: "mine"}); err != nil {
		t.Errorf("other user may reuse keyword: %v", err)
	}
	list, _, _ := s.ListSnippets(ctx, LibraryFilter{UserID: b.ID})
	if len(list) != 2 {
		t.Fatalf("b sees %d, want 2 (own + shared)", len(list))
	}
	own, _ := s.GetSnippetByKeyword(ctx, b.ID, "sig")
	if own.Content != "mine" {
		t.Errorf("own keyword should win, got %q", own.Content)
	}
	sh, _ := s.GetSnippetByName(ctx, b.ID, "shared SIG")
	if sh == nil || len(sh.Arguments) != 1 || sh.Arguments[0].Name != "who" {
		t.Errorf("arguments not parsed: %+v", sh)
	}
}
