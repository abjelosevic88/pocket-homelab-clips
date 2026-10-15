import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, V1 } from '../lib/api'
import type { Clip, Quicklink, SearchResult, Snippet } from '../lib/types'
import { useActions } from '../lib/actions'
import { copyText } from '../lib/clipboard'
import { ClipMeta, ClipPreview, ClipRow, Hints, QuicklinkMeta, QuicklinkRow, SnippetMeta, SnippetRow, Template, useMedia } from '../components/items'
import { Modal } from '../components/ui'

type Row = { kind: 'clip'; item: Clip } | { kind: 'snippet'; item: Snippet } | { kind: 'quicklink'; item: Quicklink }

/** The root search: one box over clips, snippets and quicklinks, keyboard first. */
export default function Search() {
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get('q') || '')
  const [res, setRes] = useState<SearchResult | null>(null)
  const [hl, setHl] = useState(0)
  const [sheet, setSheet] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const ctrl = useRef<AbortController | null>(null)
  const narrow = useMedia('(max-width: 900px)')
  const { copyClip, useSnippet, openQuicklink, prompt, toast } = useActions()
  const navigate = useNavigate()

  const load = useCallback(async (query: string) => {
    ctrl.current?.abort()
    const c = new AbortController()
    ctrl.current = c
    try {
      const r = await fetch(`${V1}/search?q=${encodeURIComponent(query)}&limit=${query ? 12 : 15}`, { signal: c.signal, credentials: 'same-origin' })
      if (r.status === 401) window.dispatchEvent(new CustomEvent('pc:unauthorized'))
      if (!r.ok) return
      const d = (await r.json()) as SearchResult
      if (!c.signal.aborted) { setRes(d); setHl(0) }
    } catch (e) { if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'err') }
  }, [toast])
  useEffect(() => { const t = setTimeout(() => load(q), q ? 60 : 0); return () => clearTimeout(t) }, [q, load])
  useEffect(() => { input.current?.focus() }, [])

  const rows = useMemo<Row[]>(() => {
    if (!res) return []
    const out: Row[] = []
    const pinnedFirst = <T extends { pinned: boolean }>(xs: T[]) => q ? xs : xs.filter(x => x.pinned).concat(xs.filter(x => !x.pinned)).slice(0, 4)
    for (const s of pinnedFirst(res.snippets)) out.push({ kind: 'snippet', item: s })
    for (const l of pinnedFirst(res.quicklinks)) out.push({ kind: 'quicklink', item: l })
    for (const c of res.clips) out.push({ kind: 'clip', item: c })
    // with a query, put the section with the best match first: clips when they match, else library
    if (q && res.clips.length && (!res.snippets.length && !res.quicklinks.length)) return out
    return out
  }, [res, q])
  const cur = rows[hl]

  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${hl}"]`)?.scrollIntoView({ block: 'nearest' }) }, [hl])

  const primary = async (r: Row | undefined) => {
    if (!r) return
    if (r.kind === 'clip') { const u = await copyClip(r.item); if (u) load(q) }
    else if (r.kind === 'snippet') { if (await useSnippet(r.item)) load(q) }
    else if (await openQuicklink(r.item)) load(q)
  }
  const secondary = async (r: Row | undefined) => {
    if (!r) return
    if (r.kind === 'clip' && r.item.kind === 'link') window.open(r.item.content.startsWith('www.') ? 'https://' + r.item.content : r.item.content, '_blank', 'noopener')
    else if (r.kind === 'clip') { await api.put(`${V1}/clips/${r.item.id}`, { pinned: !r.item.pinned }); toast(r.item.pinned ? 'Unpinned' : 'Pinned'); load(q) }
    else if (r.kind === 'snippet') { await copyText(r.item.content); toast('Template copied') }
    else { await copyText(r.item.link); toast('Link copied') }
  }
  const remove = async (r: Row | undefined) => {
    if (!r || r.kind !== 'clip') return
    await api.del(`${V1}/clips/${r.item.id}`); toast('Deleted'); load(q)
  }
  const onKey = (e: React.KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl(h => Math.min(rows.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(h => Math.max(0, h - 1)) }
    else if (e.key === 'Enter' && meta) { e.preventDefault(); secondary(cur) }
    else if (e.key === 'Enter') { e.preventDefault(); primary(cur) }
    else if (e.key === 'Backspace' && meta) { e.preventDefault(); remove(cur) }
    else if (e.key === 'Escape') { if (q) setQ(''); else input.current?.blur() }
    else if (e.key.toLowerCase() === 'p' && meta && cur?.kind === 'clip') { e.preventDefault(); secondary(cur) }
    else if (e.key.toLowerCase() === 'e' && meta && cur && cur.kind !== 'clip') { e.preventDefault(); navigate(`/${cur.kind}s?edit=${cur.item.id}`) }
  }

  const sections: { title: string; rows: { row: Row; i: number }[]; more?: string }[] = []
  rows.forEach((row, i) => {
    const title = row.kind === 'snippet' ? 'Snippets' : row.kind === 'quicklink' ? 'Quicklinks' : q ? 'Clipboard' : 'Recent clips'
    let s = sections.find(x => x.title === title)
    if (!s) { s = { title, rows: [] }; sections.push(s) }
    s.rows.push({ row, i })
  })
  for (const s of sections) {
    const total = s.title === 'Snippets' ? res?.snippets_total : s.title === 'Quicklinks' ? res?.quicklinks_total : res?.clips_total
    if (total && total > s.rows.length) s.more = `/${s.title === 'Snippets' ? 'snippets' : s.title === 'Quicklinks' ? 'quicklinks' : 'clipboard'}?q=${encodeURIComponent(q)}`
  }

  const detail = cur && (
    <div className="detail-body">
      {cur.kind === 'clip' && <><ClipPreview c={cur.item} /><ClipMeta c={cur.item} /></>}
      {cur.kind === 'snippet' && <><pre className="preview text"><Template text={cur.item.content} /></pre><SnippetMeta s={cur.item} /></>}
      {cur.kind === 'quicklink' && <><div className="preview"><code className="break"><Template text={cur.item.link} /></code></div><QuicklinkMeta q={cur.item} /></>}
      <div className="row wrap mt">
        <button className="btn primary" onClick={() => primary(cur)}>{cur.kind === 'clip' ? 'Copy' : cur.kind === 'snippet' ? 'Copy expanded' : 'Open'}</button>
        <button className="btn" onClick={() => secondary(cur)}>{cur.kind === 'clip' ? (cur.item.kind === 'link' ? 'Open link' : cur.item.pinned ? 'Unpin' : 'Pin') : cur.kind === 'snippet' ? 'Copy template' : 'Copy link'}</button>
        {cur.kind !== 'clip' && <button className="btn" onClick={() => navigate(`/${cur.kind}s?edit=${cur.item.id}`)}>Edit</button>}
        {cur.kind === 'clip' && <button className="btn ghost danger-text" onClick={() => remove(cur)}>Delete</button>}
      </div>
    </div>
  )

  return (
    <div className="palette">
      <div className="pal-search">
        <span className="ico">⌕</span>
        <input ref={input} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search clipboard, snippets and quicklinks…" autoComplete="off" spellCheck={false} aria-label="Search" />
        {q && <button className="btn ghost sm clear" onClick={() => { setQ(''); input.current?.focus() }} aria-label="Clear">✕</button>}
      </div>
      <div className={`pal-body ${cur ? 'has-detail' : ''}`}>
        <div className="pal-list" ref={list} role="listbox">
          {res && rows.length === 0 && <div className="empty"><h3>{q ? 'No matches' : 'Nothing here yet'}</h3><p className="muted">{q ? 'Try fewer letters — search matches word beginnings and substrings.' : 'Copy something with a connected client, or add a snippet or quicklink.'}</p></div>}
          {sections.map(s => (
            <div key={s.title} className="pal-section">
              <div className="pal-head"><span>{s.title}</span>{s.more && <a href={s.more} onClick={e => { e.preventDefault(); navigate(s.more!) }}>Show all</a>}</div>
              {s.rows.map(({ row, i }) => {
                const common = { hl: i === hl, onClick: () => { setHl(i); if (narrow) setSheet(true) }, onDoubleClick: () => primary(row) }
                return <div key={row.kind + row.item.id} data-i={i} onMouseMove={() => hl !== i && setHl(i)}>
                  {row.kind === 'clip' ? <ClipRow c={row.item} {...common} /> : row.kind === 'snippet' ? <SnippetRow s={row.item} {...common} /> : <QuicklinkRow q={row.item} {...common} />}
                </div>
              })}
            </div>
          ))}
        </div>
        {!narrow && cur && <aside className="detail">{detail}</aside>}
      </div>
      <Hints items={cur?.kind === 'clip' ? [['↵', 'Copy'], ['⌘↵', cur.item.kind === 'link' ? 'Open' : 'Pin'], ['⌘⌫', 'Delete'], ['↑↓', 'Move']] : cur?.kind === 'snippet' ? [['↵', 'Copy expanded'], ['⌘↵', 'Copy template'], ['⌘E', 'Edit'], ['↑↓', 'Move']] : cur ? [['↵', 'Open'], ['⌘↵', 'Copy link'], ['⌘E', 'Edit'], ['↑↓', 'Move']] : [['⌘K', 'Focus search'], ['↑↓', 'Move'], ['esc', 'Clear']]} />
      {narrow && sheet && cur && <Modal title={cur.kind === 'clip' ? 'Clip' : cur.item.name} onClose={() => setSheet(false)}>{detail}</Modal>}
      {prompt}
    </div>
  )
}
