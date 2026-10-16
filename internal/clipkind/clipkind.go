// Package clipkind classifies clipboard content (text, link, color) and
// measures it, so the clipboard history can show a type per entry.
package clipkind

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

var (
	urlRe   = regexp.MustCompile(`(?i)^(https?|ftp)://[^\s]+$`)
	wwwRe   = regexp.MustCompile(`(?i)^www\.[^\s]+\.[a-z]{2,}(/[^\s]*)?$`)
	hexRe   = regexp.MustCompile(`^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$`)
	funcRe  = regexp.MustCompile(`(?i)^(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[-\d.%\s,/a-z]+\)$`)
	wordsRe = regexp.MustCompile(`\S+`)
)

// Detect returns the kind for a piece of text: "link" for a single URL,
// "color" for a CSS colour, otherwise "text".
func Detect(content string) string {
	t := strings.TrimSpace(content)
	if t == "" || strings.ContainsAny(t, "\n\r") {
		return "text"
	}
	if urlRe.MatchString(t) || wwwRe.MatchString(t) {
		return "link"
	}
	if hexRe.MatchString(t) || funcRe.MatchString(t) {
		return "color"
	}
	return "text"
}

// Stats counts bytes, characters, words and lines.
func Stats(content string) (bytes int64, chars, words, lines int) {
	bytes = int64(len(content))
	chars = utf8.RuneCountInString(content)
	words = len(wordsRe.FindAllStringIndex(content, -1))
	if content != "" {
		lines = strings.Count(content, "\n") + 1
	}
	return
}

// FirstLine returns a short, single-line label for the content.
func FirstLine(content string, max int) string {
	t := strings.TrimSpace(content)
	if i := strings.IndexAny(t, "\n\r"); i >= 0 {
		t = t[:i]
	}
	t = strings.Join(strings.Fields(t), " ")
	if utf8.RuneCountInString(t) > max {
		r := []rune(t)
		t = string(r[:max]) + "…"
	}
	return t
}
