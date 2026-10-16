import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

export interface Completion { insert: string; label?: string; hint?: string }

/** Placeholders a snippet understands. `…` marks where the caret should land. */
export const SNIPPET_COMPLETIONS: Completion[] = [
  { insert: '{clipboard}', hint: 'Clipboard contents' },
  { insert: '{selection}', hint: 'Selected text (if the client sends it)' },
  { insert: '{cursor}', hint: 'Where the caret ends up after pasting' },
  { insert: '{date}', hint: 'Today, 2026-10-15' },
  { insert: '{time}', hint: 'Now, 09:05' },
  { insert: '{datetime}', hint: 'Today and now' },
  { insert: '{day}', hint: 'Weekday name' },
  { insert: '{date format="d MMMM yyyy"}', label: '{date format="…"}', hint: 'Formatted: yyyy MM MMM dd EEE HH mm' },
  { insert: '{date offset="+1d"}', label: '{date offset="…"}', hint: '+1d, -2w, +3M, +1y' },
  { insert: '{date offset="+1w" format="EEEE"}', label: '{date offset="…" format="…"}', hint: 'Both together' },
  { insert: '{time format="h:mm a"}', label: '{time format="…"}', hint: '12-hour clock' },
  { insert: '{argument name=""}', label: '{argument name="…"}', hint: 'Asked for when the snippet is used' },
  { insert: '{argument name="" default=""}', label: '{argument name="…" default="…"}', hint: 'Asked for, with a default' },
  { insert: '{snippet name=""}', label: '{snippet name="…"}', hint: 'Nest another snippet' },
  { insert: '{uuid}', hint: 'Random UUID' },
]

/** Placeholders a quicklink URL understands. */
export const QUICKLINK_COMPLETIONS: Completion[] = [
  { insert: '{Query}', hint: 'What you type when opening it' },
  { insert: '{argument name=""}', label: '{argument name="…"}', hint: 'A named input' },
  { insert: '{argument name="" default=""}', label: '{argument name="…" default="…"}', hint: 'A named input with a default' },
  { insert: '{clipboard}', hint: 'Clipboard contents, URL-encoded' },
  { insert: '{selection}', hint: 'Selected text, URL-encoded' },
]

interface Props {
  value: string
  onChange: (v: string) => void
  completions: Completion[]
  /** Extra completions offered after "{snippet name=" (existing snippet names). */
  snippetNames?: string[]
  multiline?: boolean
  className?: string
  placeholder?: string
  rows?: number
  required?: boolean
  autoFocus?: boolean
  spellCheck?: boolean
  inputRef?: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>
}

/** A textarea or input that pops up placeholder completions when you type "{".
 *  ↑↓ move, ↵ or Tab insert, Esc closes. */
export function PlaceholderEditor({ value, onChange, completions, snippetNames = [], multiline = true, className = '', placeholder, rows = 8, required, autoFocus, spellCheck = false, inputRef }: Props) {
  const own = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const ref = (inputRef || own) as React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>
  const [open, setOpen] = useState(false)
  const [hl, setHl] = useState(0)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [ctx, setCtx] = useState<{ start: number; prefix: string }>({ start: -1, prefix: '' })
  const list = useRef<HTMLDivElement>(null)

  // What is being completed: the text from the last unclosed "{" up to the caret.
  const detect = (v: string, caret: number) => {
    const before = v.slice(0, caret)
    const i = before.lastIndexOf('{')
    if (i < 0 || before.indexOf('}', i) >= 0 || /[\n]/.test(before.slice(i))) return null
    return { start: i, prefix: before.slice(i + 1) }
  }

  const items = useMemo<Completion[]>(() => {
    const p = ctx.prefix
    const m = /^snippet\s+name="([^"]*)$/i.exec(p)
    if (m) {
      const q = m[1].toLowerCase()
      return snippetNames.filter(n => n.toLowerCase().includes(q)).slice(0, 12).map(n => ({ insert: `{snippet name="${n}"}`, label: n, hint: 'Snippet' }))
    }
    const q = p.toLowerCase().replace(/^\s+/, '')
    const scored = completions
      .map(c => { const t = (c.label || c.insert).slice(1).toLowerCase(); return { c, s: t.startsWith(q) ? 2 : t.includes(q) ? 1 : 0 } })
      .filter(x => q === '' || x.s > 0)
      .sort((a, b) => b.s - a.s)
    return scored.map(x => x.c)
  }, [ctx.prefix, completions, snippetNames])

  useEffect(() => { setHl(0) }, [ctx.prefix])
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${hl}"]`)?.scrollIntoView({ block: 'nearest' }) }, [hl])

  const update = (v: string, caret: number) => {
    const d = detect(v, caret)
    if (d) { setCtx(d); setOpen(true); placeAt(caret) } else setOpen(false)
  }

  /** Measures the caret's position with a mirror element so the popup sits under it. */
  const placeAt = (caret: number) => {
    const el = ref.current
    if (!el) return
    const cs = getComputedStyle(el)
    const mirror = document.createElement('div')
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderTopWidth', 'boxSizing', 'whiteSpace', 'wordWrap', 'overflowWrap', 'tabSize'] as const) (mirror.style as unknown as Record<string, string>)[p] = cs[p]
    mirror.style.position = 'absolute'; mirror.style.visibility = 'hidden'; mirror.style.top = '0'; mirror.style.left = '0'
    mirror.style.width = el.clientWidth + 'px'
    mirror.style.whiteSpace = multiline ? 'pre-wrap' : 'pre'
    mirror.style.overflowWrap = multiline ? 'break-word' : 'normal'
    mirror.textContent = el.value.slice(0, caret)
    const span = document.createElement('span'); span.textContent = '​'
    mirror.appendChild(span)
    el.parentElement!.appendChild(mirror)
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4
    const top = span.offsetTop - el.scrollTop + lh + 4
    const left = Math.min(span.offsetLeft - el.scrollLeft, el.clientWidth - 280)
    mirror.remove()
    setPos({ top: Math.max(0, top), left: Math.max(0, left) })
  }
  useLayoutEffect(() => { if (open && ref.current) placeAt(ref.current.selectionStart || 0) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (c: Completion) => {
    const el = ref.current
    if (!el) return
    const caret = el.selectionStart ?? value.length
    const before = value.slice(0, ctx.start), after = value.slice(caret)
    const next = before + c.insert + after
    onChange(next)
    // caret: inside the first empty quotes, else right after the placeholder
    const empty = c.insert.indexOf('""')
    const at = before.length + (empty >= 0 ? empty + 1 : c.insert.length)
    setOpen(false)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(at, at) })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || items.length === 0) { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false) } return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl(h => Math.min(items.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(h => Math.max(0, h - 1)) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(items[hl]) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) }
    else if (e.key === '}') setOpen(false)
  }
  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => { onChange(e.target.value); update(e.target.value, e.target.selectionStart ?? e.target.value.length) }
  const onSelect = (e: React.SyntheticEvent<HTMLTextAreaElement | HTMLInputElement>) => { const t = e.currentTarget; if (open) { const d = detect(t.value, t.selectionStart ?? 0); if (d) setCtx(d); else setOpen(false) } }

  const common = { value, onChange: onInput, onKeyDown, onSelect, onBlur: () => setTimeout(() => setOpen(false), 120), className, placeholder, required, autoFocus, spellCheck, autoComplete: 'off' as const }
  return (
    <div className="ph-editor">
      {multiline ? <textarea ref={ref as React.RefObject<HTMLTextAreaElement>} rows={rows} {...common} /> : <input ref={ref as React.RefObject<HTMLInputElement>} {...common} />}
      {open && items.length > 0 && (
        <div className="ph-pop" style={{ top: pos.top, left: pos.left }} ref={list} role="listbox">
          {items.map((c, i) => (
            <div key={c.insert} data-i={i} role="option" aria-selected={i === hl} className={`ph-opt ${i === hl ? 'hl' : ''}`} onMouseDown={e => { e.preventDefault(); pick(c) }} onMouseEnter={() => setHl(i)}>
              <span className="mono">{c.label || c.insert}</span>{c.hint && <span className="muted small">{c.hint}</span>}
            </div>
          ))}
          <div className="ph-foot muted small"><span className="kbd">↵</span> insert · <span className="kbd">esc</span> close</div>
        </div>
      )}
    </div>
  )
}
