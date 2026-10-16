// Package snippet expands dynamic placeholders in snippets and quicklinks:
//
//	{clipboard} {selection} {cursor} {uuid}
//	{date} {time} {datetime} {day}            with optional format="…" offset="+1d"
//	{argument name="x" default="y"}
//	{snippet name="Other snippet"}
//
// Formats use the Unicode letters (yyyy-MM-dd HH:mm), not Go's.
package snippet

import (
	"crypto/rand"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Input is everything the client knows at expansion time.
type Input struct {
	Clipboard string
	Selection string
	Args      map[string]string
	Now       time.Time
	// Lookup resolves {snippet name="…"} to its content; nil disables nesting.
	Lookup func(name string) (string, bool)
}

// Result is the expanded text.
type Result struct {
	Text    string   `json:"text"`
	Cursor  int      `json:"cursor"`  // rune offset of {cursor}, or -1
	Missing []string `json:"missing"` // arguments without value or default
}

var phRe = regexp.MustCompile(`\{\s*([a-zA-Z]+)([^{}]*)\}`)
var attrRe = regexp.MustCompile(`(\w+)\s*=\s*"([^"]*)"`)

const cursorMark = "\x00CURSOR\x00"

// Expand replaces every placeholder in tpl.
func Expand(tpl string, in Input) Result {
	if in.Now.IsZero() {
		in.Now = time.Now()
	}
	res := Result{Cursor: -1}
	seen := map[string]bool{}
	text := expand(tpl, in, &res, seen, 0)
	if i := strings.Index(text, cursorMark); i >= 0 {
		res.Cursor = len([]rune(text[:i]))
		text = strings.Replace(text, cursorMark, "", 1)
	}
	text = strings.ReplaceAll(text, cursorMark, "")
	res.Text = text
	return res
}

func expand(tpl string, in Input, res *Result, seen map[string]bool, depth int) string {
	return phRe.ReplaceAllStringFunc(tpl, func(m string) string {
		sm := phRe.FindStringSubmatch(m)
		name, rest := strings.ToLower(sm[1]), sm[2]
		attrs := map[string]string{}
		for _, kv := range attrRe.FindAllStringSubmatch(rest, -1) {
			attrs[strings.ToLower(kv[1])] = kv[2]
		}
		switch name {
		case "clipboard":
			return in.Clipboard
		case "selection":
			return in.Selection
		case "cursor":
			return cursorMark
		case "uuid":
			return uuid()
		case "date", "time", "datetime", "day":
			t := in.Now
			if off, ok := attrs["offset"]; ok {
				t = applyOffset(t, off)
			}
			f := attrs["format"]
			if f == "" {
				f = map[string]string{"date": "yyyy-MM-dd", "time": "HH:mm", "datetime": "yyyy-MM-dd HH:mm", "day": "EEEE"}[name]
			}
			return t.Format(GoLayout(f))
		case "argument":
			n := attrs["name"]
			if n == "" {
				n = "argument"
			}
			if v, ok := in.Args[n]; ok && v != "" {
				return v
			}
			if d, ok := attrs["default"]; ok {
				return d
			}
			if !contains(res.Missing, n) {
				res.Missing = append(res.Missing, n)
			}
			return ""
		case "query": // the classic quicklink placeholder
			if v, ok := in.Args["query"]; ok {
				return v
			}
			if !contains(res.Missing, "query") {
				res.Missing = append(res.Missing, "query")
			}
			return ""
		case "snippet":
			n := attrs["name"]
			if in.Lookup == nil || n == "" || depth > 5 || seen[strings.ToLower(n)] {
				return ""
			}
			body, ok := in.Lookup(n)
			if !ok {
				return m
			}
			seen[strings.ToLower(n)] = true
			out := expand(body, in, res, seen, depth+1)
			delete(seen, strings.ToLower(n))
			return out
		}
		return m // unknown: leave as typed
	})
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

var offRe = regexp.MustCompile(`([+-]?\d+)\s*([a-zA-Z]+)`)

// applyOffset handles "+1d", "-2w", "+3M", "+1y", "+90m", "+2h", also "+1 day".
func applyOffset(t time.Time, off string) time.Time {
	for _, m := range offRe.FindAllStringSubmatch(off, -1) {
		n, _ := strconv.Atoi(m[1])
		switch u := m[2]; {
		case u == "y" || strings.HasPrefix(u, "year"):
			t = t.AddDate(n, 0, 0)
		case u == "M" || strings.HasPrefix(u, "month"):
			t = t.AddDate(0, n, 0)
		case u == "w" || strings.HasPrefix(u, "week"):
			t = t.AddDate(0, 0, 7*n)
		case u == "d" || strings.HasPrefix(u, "day"):
			t = t.AddDate(0, 0, n)
		case u == "h" || strings.HasPrefix(u, "hour"):
			t = t.Add(time.Duration(n) * time.Hour)
		case u == "m" || strings.HasPrefix(u, "min"):
			t = t.Add(time.Duration(n) * time.Minute)
		case u == "s" || strings.HasPrefix(u, "sec"):
			t = t.Add(time.Duration(n) * time.Second)
		}
	}
	return t
}

// GoLayout converts a Unicode date pattern (yyyy-MM-dd HH:mm:ss, EEEE, MMM, a)
// into a Go time layout. Text in single quotes is literal.
func GoLayout(p string) string {
	var b strings.Builder
	rs := []rune(p)
	for i := 0; i < len(rs); {
		r := rs[i]
		if r == '\'' {
			j := i + 1
			for j < len(rs) && rs[j] != '\'' {
				j++
			}
			if j == i+1 {
				b.WriteRune('\'')
			} else {
				b.WriteString(string(rs[i+1 : j]))
			}
			i = j + 1
			continue
		}
		if !isPatternLetter(r) {
			b.WriteRune(r)
			i++
			continue
		}
		n := 1
		for i+n < len(rs) && rs[i+n] == r {
			n++
		}
		b.WriteString(token(r, n))
		i += n
	}
	return b.String()
}

func isPatternLetter(r rune) bool {
	return strings.ContainsRune("yMdEHhmsaSzZX", r)
}

func token(r rune, n int) string {
	switch r {
	case 'y':
		if n == 2 {
			return "06"
		}
		return "2006"
	case 'M':
		switch {
		case n >= 4:
			return "January"
		case n == 3:
			return "Jan"
		case n == 2:
			return "01"
		}
		return "1"
	case 'd':
		if n >= 2 {
			return "02"
		}
		return "2"
	case 'E':
		if n >= 4 {
			return "Monday"
		}
		return "Mon"
	case 'H':
		return "15"
	case 'h':
		if n >= 2 {
			return "03"
		}
		return "3"
	case 'm':
		if n >= 2 {
			return "04"
		}
		return "4"
	case 's':
		if n >= 2 {
			return "05"
		}
		return "5"
	case 'a':
		return "PM"
	case 'S': // fractional seconds; the pattern carries its own dot (ss.SSS)
		return strings.Repeat("0", n)
	case 'z':
		return "MST"
	case 'Z':
		return "-0700"
	case 'X':
		return "Z07:00"
	}
	return strings.Repeat(string(r), n)
}

func uuid() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
