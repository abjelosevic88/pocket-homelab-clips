package snippet

import (
	"strings"
	"testing"
	"time"
)

func TestExpand(t *testing.T) {
	now := time.Date(2026, 10, 15, 9, 5, 7, 0, time.UTC)
	in := Input{Clipboard: "CLIP", Args: map[string]string{"name": "Ana"}, Now: now, Lookup: func(n string) (string, bool) {
		if n == "sig" {
			return "-- {argument name=\"name\"}", true
		}
		return "", false
	}}
	cases := map[string]string{
		"Hi {argument name=\"name\"}!":                    "Hi Ana!",
		"Dear {argument name=\"who\" default=\"friend\"}": "Dear friend",
		"{date}":                       "2026-10-15",
		"{time}":                       "09:05",
		"{datetime}":                   "2026-10-15 09:05",
		"{day}":                        "Thursday",
		"{date format=\"dd.MM.yyyy\"}": "15.10.2026",
		"{date offset=\"+1d\" format=\"EEE, d MMM yyyy\"}": "Fri, 16 Oct 2026",
		"{date offset=\"-1M\" format=\"MMMM yy\"}":         "September 26",
		"{time format=\"h:mm a\"}":                         "9:05 AM",
		"{date format=\"yyyy-MM-dd'T'HH:mm:ss\"}":          "2026-10-15T09:05:07",
		"paste: {clipboard}":                               "paste: CLIP",
		"{snippet name=\"sig\"}":                           "-- Ana",
		"{snippet name=\"nope\"}":                          "{snippet name=\"nope\"}",
		"{unknown}":                                        "{unknown}",
		"q={Query}":                                        "q=",
	}
	for tpl, want := range cases {
		if got := Expand(tpl, in).Text; got != want {
			t.Errorf("Expand(%q) = %q, want %q", tpl, got, want)
		}
	}
	r := Expand("a{cursor}b {argument name=\"x\"}", in)
	if r.Text != "ab " || r.Cursor != 1 || len(r.Missing) != 1 || r.Missing[0] != "x" {
		t.Errorf("cursor/missing: %+v", r)
	}
	if u := Expand("{uuid}", in).Text; len(u) != 36 || strings.Count(u, "-") != 4 {
		t.Errorf("uuid %q", u)
	}
}

func TestGoLayout(t *testing.T) {
	if got := GoLayout("yyyy/MM/dd HH:mm:ss.SSS"); got != "2006/01/02 15:04:05.000" {
		t.Errorf("got %q", got)
	}
}
