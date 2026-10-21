// ⌘K / "/" — search clips, snippets and quicklinks and act on them, jump to a folder, or run a command.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { V1 } from '../lib/api'
import { useApp } from '../lib/app-context'
import type { useActions } from '../lib/actions'
import type { SearchResult } from '../lib/types'
import { announceChange } from '../lib/events'
import { Icon } from './icons'
import { Favicon, Highlight, KindIcon, clipLabel } from './items'
import { useDebounce } from './ui'

export interface PaletteCommand { id: string; label: string; icon: string; hint?: string; keywords?: string; run: () => void }

type Row = { key: string; group: string; icon: React.ReactNode; label: React.ReactNode; sub?: React.ReactNode; hint?: string; run: () => void | Promise<unknown> }

export function CommandPalette({ onClose, commands, actions }: { onClose: () => void; commands: PaletteCommand[]; actions: ReturnType<typeof useActions> }) {
  const { folders } = useApp()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const dq = useDebounce(q, 90)
  const [hi, setHi] = useState(0)
  const [res, setRes] = useState<SearchResult | null>(null)
  const list = useRef<HTMLDivElement>(null)

  // live results from the same FTS search the Search page uses
  useEffect(() => {
    const c = new AbortController()
    fetch(`${V1}/search?q=${encodeURIComponent(dq.trim())}&limit=${dq.trim() ? 5 : 4}`, { signal: c.signal, credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null).then(d => { if (!c.signal.aborted) setRes(d) }).catch(() => {})
    return () => c.abort()
  }, [dq])

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const n = q.trim().toLowerCase()
    const words = n.split(/\s+/).filter(Boolean)
    const hit = (text: string) => words.every(w => text.toLowerCase().includes(w))
    const done = (p: Promise<unknown>) => p.then(r => { if (r) announceChange() })
    if (res && (n || dq === '')) {
      const pinnedFirst = <T extends { pinned: boolean }>(xs: T[]) => n ? xs : xs.filter(x => x.pinned)
      for (const s of pinnedFirst(res.snippets)) out.push({ key: 's' + s.id, group: 'Snippets', icon: <span className="kind-ico snippet sm"><Icon name="scissors" size={14} /></span>, label: <>{s.name}{s.keyword && <span className="kw">{s.keyword}</span>}</>, sub: s.snippet ? <Highlight text={s.snippet} /> : s.content.split(/\r?\n/)[0], hint: 'Copy', run: () => done(actions.useSnippet(s)) })
      for (const l of pinnedFirst(res.quicklinks)) out.push({ key: 'q' + l.id, group: 'Quicklinks', icon: <Favicon q={l} size={14} />, label: <>{l.name}{l.keyword && <span className="kw">{l.keyword}</span>}</>, sub: l.link, hint: 'Open', run: () => done(actions.openQuicklink(l)) })
      for (const c of res.clips) out.push({ key: 'c' + c.id, group: n ? 'Clipboard' : 'Recent clips', icon: <KindIcon kind={c.kind} color={c.kind === 'color' ? c.content : undefined} size="sm" />, label: c.snippet && c.kind !== 'image' ? <Highlight text={c.snippet} /> : clipLabel(c), sub: c.kind === 'link' && c.title ? c.title : c.source_app || undefined, hint: 'Copy', run: () => done(actions.copyClip(c)) })
    }
    for (const f of folders.snippets) if (n && hit(`${f} snippets folder`)) out.push({ key: 'fs' + f, group: 'Folders', icon: <Icon name="folder" size={16} />, label: f, sub: 'Snippet folder', run: () => navigate(`/snippets?folder=${encodeURIComponent(f)}`) })
    for (const f of folders.quicklinks) if (n && hit(`${f} quicklinks folder`)) out.push({ key: 'fq' + f, group: 'Folders', icon: <Icon name="folder" size={16} />, label: f, sub: 'Quicklink folder', run: () => navigate(`/quicklinks?folder=${encodeURIComponent(f)}`) })
    for (const c of commands) {
      if (n && !hit(`${c.label} ${c.keywords || ''}`)) continue
      out.push({ key: c.id, group: 'Commands', icon: <Icon name={c.icon} size={16} />, label: c.label, hint: c.hint, run: c.run })
    }
    if (n) out.push({ key: 'all', group: 'Commands', icon: <Icon name="search" size={16} />, label: <>Search everything for “{q.trim()}”</>, run: () => navigate(`/search?q=${encodeURIComponent(q.trim())}`) })
    return out
  }, [q, dq, res, folders, commands, navigate, actions])
  useEffect(() => setHi(0), [q, res])
  useEffect(() => { list.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }) }, [hi])

  const run = (r: Row | undefined) => { if (!r) return; onClose(); r.run() }
  let last = ''
  return createPortal(
    <div className="palette-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette-box" role="dialog" aria-label="Search and commands">
        <div className="pal-input">
          <Icon name="search" size={18} />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search clips, snippets and quicklinks, or run a command…" aria-label="Search" autoComplete="off" spellCheck={false}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(rows.length - 1, h + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)) }
              else if (e.key === 'Enter') { e.preventDefault(); run(rows[hi]) }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
            }} />
          <kbd>esc</kbd>
        </div>
        <div className="pal-list" ref={list} role="listbox">
          {rows.length === 0 && <div className="pal-empty">Nothing matches.</div>}
          {rows.map((r, i) => {
            const head = r.group !== last ? <div className="pal-group" key={'g' + r.group}>{r.group}</div> : null
            last = r.group
            return (
              <React.Fragment key={r.key}>
                {head}
                <div data-i={i} role="option" aria-selected={i === hi} className={`pal-row ${i === hi ? 'hi' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => run(r)}>
                  <span className="pal-ico">{r.icon}</span>
                  <span className="grow"><span className="pal-label ellipsis">{r.label}</span>{r.sub && <span className="pal-sub ellipsis">{r.sub}</span>}</span>
                  {r.hint && (i === hi || r.group === 'Commands') && <kbd>{i === hi && r.group !== 'Commands' ? `↵ ${r.hint}` : r.hint}</kbd>}
                  {i === hi && r.group === 'Commands' && <Icon name="chevron-right" size={14} className="muted" />}
                </div>
              </React.Fragment>
            )
          })}
        </div>
      </div>
    </div>, document.body)
}
