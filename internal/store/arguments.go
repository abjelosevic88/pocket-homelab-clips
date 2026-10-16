package store

import "regexp"

var argRe = regexp.MustCompile(`\{\s*argument\s+([^}]*)\}`)
var attrRe = regexp.MustCompile(`(\w+)\s*=\s*"([^"]*)"`)
var queryRe = regexp.MustCompile(`(?i)\{query\}`)

// ParseArguments lists the {argument name="…" default="…"} placeholders of a
// template (and {Query}, the classic quicklink placeholder, as "query"),
// each name once, in order of first appearance.
func ParseArguments(tpl string) []Argument {
	out := []Argument{}
	seen := map[string]bool{}
	for _, m := range argRe.FindAllStringSubmatch(tpl, -1) {
		a := Argument{}
		for _, kv := range attrRe.FindAllStringSubmatch(m[1], -1) {
			switch kv[1] {
			case "name":
				a.Name = kv[2]
			case "default":
				a.Default = kv[2]
			}
		}
		if a.Name == "" || seen[a.Name] {
			continue
		}
		seen[a.Name] = true
		out = append(out, a)
	}
	if queryRe.MatchString(tpl) && !seen["query"] {
		out = append(out, Argument{Name: "query"})
	}
	return out
}
