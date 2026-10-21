import React, { useEffect, useState } from 'react'
import type { Argument, Clip, Kind, Quicklink, Snippet } from '../lib/types'
import { fmtBytes, fmtDateTime, hostOf, mod, plural, timeAgo, tokens } from '../lib/format'
import { api, V1 } from '../lib/api'
import { Field, Modal, useToast } from './ui'
import { Icon } from './icons'

export const KIND_LABEL: Record<Kind, string> = { text: 'Text', link: 'Link', color: 'Color', image: 'Image', file: 'File' }

export const KIND_ICON: Record<Kind, string> = { text: 'type', link: 'link', color: 'droplet', image: 'image', file: 'file' }

export function KindIcon({ kind, color, size = '' }: { kind: Kind; color?: string; size?: '' | 'sm' }) {
  if (kind === 'color' && color) return <span className={`kind-ico color ${size}`}><span className="swatch-dot" style={{ background: color }} /></span>
  return <span className={`kind-ico ${kind} ${size}`} title={KIND_LABEL[kind]}><Icon name={KIND_ICON[kind]} size={size ? 14 : 16} /></span>
}

/** The pin marker in list rows. */
export function PinMark() { return <span className="pin" title="Pinned"><Icon name="pushpin" size={13} /></span> }

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
    <div className={`fd-row ${hl ? 'hl' : ''} ${active ? 'active' : ''}`} onClick={onClick} onDoubleClick={onDoubleClick} role="option" aria-selected={hl}>
      <KindIcon kind={c.kind} color={c.kind === 'color' ? c.content : undefined} />
      <div className="fd-text">
        <div className="fd-title">{c.snippet && c.kind !== 'image' ? <Highlight text={c.snippet} /> : clipLabel(c)}</div>
        <div className="fd-sub">{c.kind === 'link' && c.title ? c.title : c.lines > 1 ? `${plural(c.lines, 'line')} · ${plural(c.chars, 'character')}` : c.source_app || KIND_LABEL[c.kind]}</div>
      </div>
      <div className="fd-meta">{c.pinned && <PinMark />}<span>{timeAgo(c.last_copied_at)}</span></div>
    </div>
  )
}

export function SnippetRow({ s, hl, active, onClick, onDoubleClick }: { s: Snippet; hl?: boolean; active?: boolean; onClick: () => void; onDoubleClick?: () => void }) {
  return (
    <div className={`fd-row ${hl ? 'hl' : ''} ${active ? 'active' : ''}`} onClick={onClick} onDoubleClick={onDoubleClick} role="option" aria-selected={hl}>
      <span className="kind-ico snippet" title="Snippet"><Icon name="scissors" size={16} /></span>
      <div className="fd-text">
        <div className="fd-title">{s.name}{s.keyword && <span className="kw">{s.keyword}</span>}</div>
        <div className="fd-sub mono">{s.snippet ? <Highlight text={s.snippet} /> : <Template text={s.content.split(/\r?\n/)[0]} />}</div>
      </div>
      <div className="fd-meta">{s.pinned && <PinMark />}{s.shared && <span className="badge" title={`Shared by ${s.owner_name}`}>shared</span>}{s.folder && <span className="badge folder">{s.folder}</span>}</div>
    </div>
  )
}

export function QuicklinkRow({ q, hl, active, onClick, onDoubleClick }: { q: Quicklink; hl?: boolean; active?: boolean; onClick: () => void; onDoubleClick?: () => void }) {
  return (
    <div className={`fd-row ${hl ? 'hl' : ''} ${active ? 'active' : ''}`} onClick={onClick} onDoubleClick={onDoubleClick} role="option" aria-selected={hl}>
      <Favicon q={q} />
      <div className="fd-text">
        <div className="fd-title">{q.name}{q.keyword && <span className="kw">{q.keyword}</span>}</div>
        <div className="fd-sub mono"><Template text={q.link} /></div>
      </div>
      <div className="fd-meta">{q.pinned && <PinMark />}{q.shared && <span className="badge" title={`Shared by ${q.owner_name}`}>shared</span>}{q.folder && <span className="badge folder">{q.folder}</span>}</div>
    </div>
  )
}

/** Metadata list in the detail pane. */
export function Meta({ rows }: { rows: [string, React.ReactNode][] }) {
  return <dl className="meta">{rows.filter(r => r[1] !== '' && r[1] !== null && r[1] !== undefined && r[1] !== 0).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
}

export function ClipPreview({ c }: { c: Clip }) {
  const [full, setFull] = useState(false)
  if (c.kind === 'image') {
    const src = `${V1}/clips/${c.id}/image`
    return <>
      <button type="button" className="preview image clickable" onClick={() => setFull(true)} title="Open full size"><img src={src} alt={c.title || 'clipboard image'} /><span className="zoom-hint"><Icon name="maximize" size={14} /></span></button>
      {full && <Lightbox src={src} title={c.title || 'Clipboard image'} meta={c.width ? `${c.width} × ${c.height} · ${fmtBytes(c.bytes)}` : fmtBytes(c.bytes)} onClose={() => setFull(false)} />}
    </>
  }
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

/** Full-screen image viewer: fit to screen, click the image for 1:1, Esc or backdrop closes. */
export function Lightbox({ src, title, meta, onClose }: { src: string; title: string; meta?: string; onClose: () => void }) {
  const [actual, setActual] = useState(false)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', h, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', h, true); document.body.style.overflow = prev }
  }, [onClose])
  return (
    <div className={`lightbox ${actual ? 'actual' : ''}`} onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="lb-bar" onClick={e => e.stopPropagation()}>
        <span className="lb-title">{title}{meta && <span className="muted"> · {meta}</span>}</span>
        <span className="spacer" />
        <button type="button" className="btn ghost sm" onClick={() => setActual(a => !a)} title={actual ? 'Fit to screen' : 'Actual size'}>{actual ? 'Fit' : '1:1'}</button>
        <a className="btn ghost sm" href={src} target="_blank" rel="noreferrer noopener"><Icon name="external" size={14} />Open original</a>
        <a className="btn ghost sm" href={src} download><Icon name="download" size={14} />Download</a>
        <button type="button" className="btn ghost icon-only" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
      </div>
      <div className="lb-body"><img src={src} alt={title} onClick={e => { e.stopPropagation(); setActual(a => !a) }} /></div>
    </div>
  )
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

/** The footer bar with keyboard hints. */
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

/** Add a text clip by hand (the shell's New → Text clip, and the Clipboard page). */
export function AddTextModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [t, setT] = useState('')
  const { toast } = useToast()
  return (
    <Modal title="Add a clip" onClose={onClose}>
      <form className="grid" style={{ gap: 12 }} onSubmit={async e => { e.preventDefault(); if (!t.trim()) return; try { await api.post(`${V1}/clips`, { content: t, source_app: 'Pocket Clips' }); toast('Clip added'); onAdded() } catch (err) { toast((err as Error).message, 'err') } }}>
        <Field label="Content" help="Links and colours are recognised automatically. Tip: just paste anywhere on the Clipboard page."><textarea value={t} onChange={e => setT(e.target.value)} autoFocus rows={6} /></Field>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!t.trim()}>Add</button></div>
      </form>
    </Modal>
  )
}
