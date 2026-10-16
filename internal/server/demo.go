package server

import (
	"context"

	"github.com/abjelosevic88/pocket-homelab-clips/internal/clipkind"
	"github.com/abjelosevic88/pocket-homelab-clips/internal/store"
)

// seedDemo fills an empty history with a few clips, snippets and quicklinks so
// the UI has something to show. Uses (or creates) the implicit admin account.
func (s *Server) seedDemo(ctx context.Context) error {
	u, err := s.firstOrSystemUser(ctx, "admin@localhost", "Admin")
	if err != nil {
		return err
	}
	if st, err := s.store.Stats(ctx, u.ID); err != nil || st.Total > 0 {
		return err
	}
	clips := []store.Clip{
		{Content: "https://github.com/abjelosevic88/pocket-homelab-clips", Title: "Pocket Clips on GitHub", SourceApp: "Safari"},
		{Content: "#4f46e5", SourceApp: "Figma"},
		{Content: "docker compose up -d --build", SourceApp: "Terminal"},
		{Content: "Meeting moved to Thursday 14:00, same room. Bring the Q4 numbers.", SourceApp: "Mail"},
		{Content: "rgb(13, 148, 136)", SourceApp: "Code"},
		{Content: "SELECT name, keyword FROM snippets WHERE shared = 1 ORDER BY use_count DESC;", SourceApp: "TablePlus"},
		{Content: "https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API", SourceApp: "Arc"},
		{Content: "The quick brown fox jumps over the lazy dog.", SourceApp: "Notes", Pinned: true},
		{Content: "ssh -L 8080:localhost:8080 home-server", SourceApp: "Terminal"},
		{Content: "Aleksandar Bjelosevic\nSenior Engineer\n+387 65 000 000", SourceApp: "Contacts"},
	}
	for i := range clips {
		c := &clips[i]
		c.UserID = u.ID
		c.Kind = clipkind.Detect(c.Content)
		c.Bytes, c.Chars, c.Words, c.Lines = clipkind.Stats(c.Content)
		c.SourceDevice = "MacBook Pro"
		if _, err := s.store.AddClip(ctx, c); err != nil {
			return err
		}
		if c.Pinned {
			_ = s.store.UpdateClip(ctx, c)
		}
	}
	snippets := []store.Snippet{
		{Name: "Email signature", Keyword: "sig", Content: "Best regards,\nAleksandar Bjelosevic\n{date format=\"EEEE, d MMMM yyyy\"}", Folder: "Work", Pinned: true},
		{Name: "Meeting notes", Keyword: "mtg", Content: "# Meeting {date}\n\nAttendees: {argument name=\"attendees\" default=\"team\"}\n\n## Agenda\n- {cursor}\n\n## Actions\n- ", Folder: "Work"},
		{Name: "Thanks reply", Keyword: "thx", Content: "Hi {argument name=\"name\"},\n\nthanks for getting back to me. I will have a look and reply by {date offset=\"+2d\" format=\"EEEE\"}.\n\n{snippet name=\"Email signature\"}", Folder: "Work"},
		{Name: "Shrug", Keyword: "shrug", Content: "¯\\_(ツ)_/¯", Shared: true},
		{Name: "Docker logs", Keyword: "dlog", Content: "docker logs --since 10m -f {argument name=\"container\"}", Folder: "Shell", Shared: true},
		{Name: "Today's note", Keyword: "note", Content: "{date format=\"yyyy-MM-dd\"} {time}\n\n{clipboard}", Folder: "Personal"},
	}
	for i := range snippets {
		snippets[i].UserID = u.ID
		if err := s.store.CreateSnippet(ctx, &snippets[i]); err != nil {
			return err
		}
	}
	links := []store.Quicklink{
		{Name: "Google", Keyword: "g", Link: "https://www.google.com/search?q={Query}", Icon: "🔍", Pinned: true},
		{Name: "GitHub search", Keyword: "gh", Link: "https://github.com/search?q={argument name=\"query\"}&type=repositories", Folder: "Dev"},
		{Name: "Go package docs", Keyword: "pkg", Link: "https://pkg.go.dev/search?q={Query}", Folder: "Dev"},
		{Name: "Wikipedia", Keyword: "w", Link: "https://en.wikipedia.org/w/index.php?search={Query}", Shared: true},
		{Name: "YouTube", Keyword: "yt", Link: "https://www.youtube.com/results?search_query={Query}", Icon: "▶️"},
		{Name: "Homelab dashboard", Keyword: "home", Link: "http://localhost:3000", Folder: "Homelab", OpenWith: "Safari"},
		{Name: "Translate to German", Keyword: "de", Link: "https://translate.google.com/?sl=auto&tl=de&text={argument name=\"text\" default=\"hello\"}&op=translate"},
	}
	for i := range links {
		links[i].UserID = u.ID
		if err := s.store.CreateQuicklink(ctx, &links[i]); err != nil {
			return err
		}
	}
	s.log.Info("demo data seeded", "clips", len(clips), "snippets", len(snippets), "quicklinks", len(links))
	return nil
}
