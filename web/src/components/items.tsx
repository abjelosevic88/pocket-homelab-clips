import React, { useEffect, useState } from 'react'
import type { Argument, Clip, Kind, Quicklink, Snippet } from '../lib/types'
import { fmtBytes, fmtDateTime, hostOf, mod, plural, timeAgo, tokens } from '../lib/format'
import { V1 } from '../lib/api'
import { Field, Modal } from './ui'

export const KIND_LABEL: Record<Kind, string> = { text: 'Text', link: 'Link', color: 'Color', image: 'Image', file: 'File' }

export function KindIcon({ kind, color }: { kind: Kind; color?: string }) {
  if (kind === 'color' && color) return <span className="kind-ico color"><span className="swatch-dot" style={{ background: color }} /></span>
  const glyph = { text: 'T', link: '↗', color: '●', image: '▣', file: '▤' }[kind]
  return <span className={`kind-ico ${kind}`} title={KIND_LABEL[kind]}>{glyph}</span>
}

export function Favicon({ q, size = 20 }: { q: Pick<Quicklink, 'link' | 'icon' | 'name'>; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (q.icon) return <span className="ql-ico emoji" style={{ width: size + 8, height: size + 8, fontSize: size * .75 }}>{q.icon}</span>
  const host = hostOf(q.link)
  if (!host || broken) return <span className="ql-ico letter" style={{ width: size + 8, height: size + 8 }}>{(q.name || host || '?')[0].toUpperCase()}</span>
  return <span className="ql-ico" style={{ width: size + 8, height: size + 8 }}><img src={`https://icons.duckduckgo.com/ip3/${host}.ico`} width={size} height={size} alt="" onError={() => setBroken(true)} loading="lazy" /></span>
}

/** Text with <mark> highlights from FTS, rendered safely. */
export function Highlight({ text }: { text: string }) {
  const parts = text.split(/(<mark>.*?<\/mark>)/g)
  return <>{parts.map((p, i) => p.startsWith('<mark>') ? <mark key={i}>{p.slice(6, -7)}</mark> : <React.Fragment key={i}>{p}</React.Fragment>)}</>
}

/** A template with its {placeholders} tinted. */
export function Template({ text }: { text: string }) {
  return <>{tokens(text).map((t, i) => t.ph ? <span key={i} className="ph">{t.text}</span> : <React.Fragment key={i}>{t.text}</React.Fragment>)}</>
}

export function clipLabel(c: Clip): string {
  if (c.kind === 'image') return c.title || `Image ${c.width && c.height ? `${c.width}×${c.height}` : ''}`.trim()
  const first = c.content.split(/\r?\n/).find(l => l.trim()) || c.content
  return first.trim()
}

export function ClipRow({ c, hl, onClick, onDoubleClick, active }: { c: Clip; hl?: boolean; active?: boolean; onClick: () => void; onDoubleClick?: () => void }) {
  return (
    <div className={`pal-row ${hl ? 'hl' : ''} ${active ? 'active' : ''}`} onClick={onClick} onDoubleClick={onDoubleClick} role="option" aria-selected={hl}>
      <KindIcon kind={c.kind} color={c.kind === 'color' ? c.content : undefined} />
      <div className="pal-text">
        <div className="pal-title">{c.snippet && c.kind !== 'image' ? <Highlight text={c.snippet} /> : clipLabel(c)}</div>
        <div className="pal-sub">{c.kind === 'link' && c.title ? c.title : c.lines > 1 ? `${plural(c.lines, 'line')} · ${plural(c.chars, 'character')}` : c.source_app || KIND_LABEL[c.kind]}</div>
      </div>
      <div className="pal-meta">{c.pinned && <span className="pin" title="Pinned">📌</span>}<span>{timeAgo(c.last_copied_at)}</span></div>
    </div>
  )
}

export function SnippetRow({ s, hl, active, onClick, onDoubleClick }: { s: Snippet; hl?: boolean; active?: boolean; onClick: () => void; onDoubleClick?: () => void }) {
  return (
    <div className={`pal-row ${hl ? 'hl' : ''} ${active ? 'active' : ''}`} onClick={onClick} onDoubleClick={onDoubleClick} role="option" aria-selected={hl}>
      <span className="kind-ico snippet" title="Snippet">✂</span>
      <div className="pal-text">
        <div className="pal-title">{s.name}{s.keyword && <span className="kw">{s.keyword}</span>}</div>
        <div className="pal-sub mono">{s.snippet ? <Highlight text={s.snippet} /> : <Template text={s.content.split(/\r?\n/)[0]} />}</div>
      </div>
      <div className="pal-meta">{s.pinned && <span className="pin">📌</span>}{s.shared && <span className="badge" title={`Shared by ${s.owner_name}`}>shared</span>}{s.folder && <span className="badge folder">{s.folder}</span>}</div>
    </div>
  )
}

export function QuicklinkRow({ q, hl, active, onClick, onDoubleClick }: { q: Quicklink; hl?: boolean; active?: boolean; onClick: () => void; onDoubleClick?: () => void }) {
  return (
    <div className={`pal-row ${hl ? 'hl' : ''} ${active ? 'active' : ''}`} onClick={onClick} onDoubleClick={onDoubleClick} role="option" aria-selected={hl}>
      <Favicon q={q} />
      <div className="pal-text">
        <div className="pal-title">{q.name}{q.keyword && <span className="kw">{q.keyword}</span>}</div>
        <div className="pal-sub mono"><Template text={q.link} /></div>
      </div>
      <div className="pal-meta">{q.pinned && <span className="pin">📌</span>}{q.shared && <span className="badge" title={`Shared by ${q.owner_name}`}>shared</span>}{q.folder && <span className="badge folder">{q.folder}</span>}</div>
    </div>
  )
}

/** Raycast-style metadata list in the detail pane. */
export function Meta({ rows }: { rows: [string, React.ReactNode][] }) {
  return <dl className="meta">{rows.filter(r => r[1] !== '' && r[1] !== null && r[1] !== undefined && r[1] !== 0).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
}

export function ClipPreview({ c }: { c: Clip }) {
  if (c.kind === 'image') return <div className="preview image"><img src={`${V1}/clips/${c.id}/image`} alt={c.title || 'clipboard image'} /></div>
  if (c.kind === 'color') return <div className="preview color"><span className="swatch-lg" style={{ background: c.content }} /><code>{c.content}</code></div>
  if (c.kind === 'link') return <div className="preview"><a href={c.content.startsWith('www.') ? 'https://' + c.content : c.content} target="_blank" rel="noreferrer noopener" className="break">{c.content}</a>{c.title && <div className="muted mt-sm">{c.title}</div>}</div>
  return <pre className="preview text">{c.content}</pre>
}

export function ClipMeta({ c }: { c: Clip }) {
  return <Meta rows={[
    ['Type', KIND_LABEL[c.kind]],
    ['Application', c.source_app],
    ['Device', c.source_device],
    ['Copied', <span title={fmtDateTime(c.last_copied_at)}>{timeAgo(c.last_copied_at)}</span>],
    ['First copied', c.copy_count > 1 ? <span title={fmtDateTime(c.first_copied_at)}>{timeAgo(c.first_copied_at)}</span> : ''],
    ['Times copied', c.copy_count > 1 ? c.copy_count : ''],
    ['Dimensions', c.width ? `${c.width} × ${c.height}` : ''],
    ['Characters', c.kind !== 'image' ? c.chars.toLocaleString() : ''],
    ['Words', c.kind === 'text' ? c.words.toLocaleString() : ''],
    ['Lines', c.lines > 1 ? c.lines.toLocaleString() : ''],
    ['Size', fmtBytes(c.bytes)],
  ]} />
}

export function SnippetMeta({ s }: { s: Snippet }) {
  return <Meta rows={[
    ['Keyword', s.keyword ? <code>{s.keyword}</code> : ''],
    ['Folder', s.folder],
    ['Arguments', s.arguments.length ? s.arguments.map(a => a.name).join(', ') : ''],
    ['Owner', s.shared ? s.owner_name : ''],
    ['Used', s.use_count ? `${plural(s.use_count, 'time')} · last ${timeAgo(s.last_used_at)}` : 'never'],
    ['Updated', <span title={fmtDateTime(s.updated_at)}>{timeAgo(s.updated_at)}</span>],
  ]} />
}

export function QuicklinkMeta({ q }: { q: Quicklink }) {
  const go = `${location.origin}/go/${q.keyword || q.id}?q=%s`
  return <Meta rows={[
    ['Keyword', q.keyword ? <code>{q.keyword}</code> : ''],
    ['Open with', q.open_with],
    ['Folder', q.folder],
    ['Arguments', q.arguments.length ? q.arguments.map(a => a.name + (a.default ? ` (default “${a.default}”)` : '')).join(', ') : ''],
    ['Owner', q.shared ? q.owner_name : ''],
    ['Used', q.use_count ? `${plural(q.use_count, 'time')} · last ${timeAgo(q.last_used_at)}` : 'never'],
    ['Search engine URL', q.arguments.length ? <code className="break small">{go}</code> : ''],
  ]} />
}

/** Asks for the {argument}s of a snippet or quicklink before use. */
export function ArgsModal({ title, args, onSubmit, onClose }: { title: string; args: Argument[]; onSubmit: (v: Record<string, string>) => void; onClose: () => void }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(args.map(a => [a.name, a.default || ''])))
  useEffect(() => { setV(Object.fromEntries(args.map(a => [a.name, a.default || '']))) }, [args])
  return (
    <Modal title={title} onClose={onClose}>
      <form className="grid" style={{ gap: 12 }} onSubmit={e => { e.preventDefault(); onSubmit(v) }}>
        {args.map((a, i) => <Field key={a.name} label={a.name}><input value={v[a.name] || ''} onChange={e => setV({ ...v, [a.name]: e.target.value })} autoFocus={i === 0} placeholder={a.default || ''} onFocus={e => e.target.select()} /></Field>)}
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Continue <span className="kbd">↵</span></button></div>
      </form>
    </Modal>
  )
}

/** The footer bar with keyboard hints, like Raycast's action bar. */
export function Hints({ items }: { items: [string, string][] }) {
  return <div className="hints">{items.map(([k, l]) => <span key={l}><span className="kbd">{k.replace('⌘', mod)}</span> {l}</span>)}</div>
}

/** Matches a media query (for list/detail layout switching). */
export function useMedia(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const h = () => setM(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [q])
  return m
}
