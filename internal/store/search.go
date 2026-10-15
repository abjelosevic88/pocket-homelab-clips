package store

import (
	"strings"
	"unicode"
)

// FTSQuery turns free text into an FTS5 MATCH expression: every word becomes
// a quoted prefix token, so "inv num" finds "Invoice number 2026". Characters
// FTS5 treats as syntax are stripped. Returns "" when nothing is left.
func FTSQuery(q string) string {
	var toks []string
	for _, w := range strings.FieldsFunc(q, func(r rune) bool {
		return unicode.IsSpace(r) || r == '"' || r == '\'' || r == '(' || r == ')' || r == '*' || r == ':' || r == '^' || r == '{' || r == '}'
	}) {
		w = strings.TrimSpace(w)
		if w == "" {
			continue
		}
		toks = append(toks, `"`+w+`"*`)
	}
	return strings.Join(toks, " ")
}

// LikePattern escapes q for a LIKE … ESCAPE '\' query.
func LikePattern(q string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(q) + "%"
}

// searchTerms splits a raw query into the LIKE text and the FTS expression. A
// leading NUL marks "LIKE only" (the retry after an empty FTS result).
func searchTerms(raw string) (q, fts string) {
	if strings.HasPrefix(raw, "\x00") {
		return strings.TrimSpace(raw[1:]), ""
	}
	q = strings.TrimSpace(raw)
	return q, FTSQuery(q)
}
