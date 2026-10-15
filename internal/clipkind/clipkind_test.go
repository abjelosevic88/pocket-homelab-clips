package clipkind

import "testing"

func TestDetect(t *testing.T) {
	cases := map[string]string{
		"https://example.com/a?b=c": "link",
		"www.example.org":           "link",
		"#fff":                      "color",
		"#0d9488":                   "color",
		"rgb(13, 148, 136)":         "color",
		"hsla(174 85% 32% / 0.5)":   "color",
		"hello world":               "text",
		"https://a.com and more":    "text",
		"line one\nhttps://b.com":   "text",
		"ftp://files.example.net/x": "link",
		"#notacolor":                "text",
	}
	for in, want := range cases {
		if got := Detect(in); got != want {
			t.Errorf("Detect(%q) = %s, want %s", in, got, want)
		}
	}
}

func TestStats(t *testing.T) {
	b, c, w, l := Stats("héllo wörld\nsecond line")
	if b != 25 || c != 23 || w != 4 || l != 2 {
		t.Errorf("got %d %d %d %d", b, c, w, l)
	}
	if _, _, _, l := Stats(""); l != 0 {
		t.Errorf("empty should have 0 lines")
	}
}

func TestFirstLine(t *testing.T) {
	if got := FirstLine("  a   b\nc", 10); got != "a b" {
		t.Errorf("got %q", got)
	}
	if got := FirstLine("abcdefghij", 5); got != "abcde…" {
		t.Errorf("got %q", got)
	}
}
