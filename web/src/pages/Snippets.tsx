import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, V1 } from '../lib/api'
import type { ExpandResult, Snippet } from '../lib/types'
import { useActions } from '../lib/actions'
import { useApp } from '../lib/app-context'
import { copyText } from '../lib/clipboard'
import { plural } from '../lib/format'
import { Hints, SnippetMeta, SnippetRow, Template, useMedia } from '../components/items'
import { Confirm, Field, Modal, PageHeader, useDebounce, useToast } from '../components/ui'
import { PlaceholderEditor, SNIPPET_COMPLETIONS } from '../components/PlaceholderEditor'

export default function Snippets() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const folder = params.get('folder') || ''
  const [items, setItems] = useState<Snippet[]>([])
  const [total, setTotal] = useState(0)
  const [hl, setHl] = useState(0)
  const [sheet, setSheet] = useState(false)
  const [edit, setEdit] = useState<Partial<Snippet> | null>(null)
  const [del, setDel] = useState<Snippet | null>(null)
  const narrow = useMedia('(max-width: 900px)')
  const { useSnippet, prompt } = useActions()
  const { toast } = useToast()
  const { user, folders: allFolders, reloadMeta } = useApp()
  const folders = allFolders.snippets
  const ctrl = useRef<AbortController | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    ctrl.current?.abort()
    const c = new AbortController(); ctrl.current = c
    try {
      const r = await fetch(`${V1}/snippets?q=${encodeURIComponent(q)}&folder=${encodeURIComponent(folder)}&limit=300`, { signal: c.signal, credentials: 'same-origin' })
      if (r.status === 401) window.dispatchEvent(new CustomEvent('pc:unauthorized'))
      const d = await r.json()
      if (!c.signal.aborted) { setItems(d.snippets); setTotal(d.total); setHl(h => Math.min(h, Math.max(0, d.snippets.length - 1))) }
    } catch (e) { if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'err') }
  }, [q, folder]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(load, q ? 60 : 0); return () => clearTimeout(t) }, [load, q])
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${hl}"]`)?.scrollIntoView({ block: 'nearest' }) }, [hl])
  // deep links from the palette / clipboard: ?edit=ID, ?new=1&content=…
  useEffect(() => {
    const id = params.get('edit')
    if (id) api.get<Snippet>(`${V1}/snippets/${id}`).then(setEdit).catch(() => {})
    if (params.get('new')) setEdit({ content: params.get('content') || '', name: params.get('name') || '' })
    if (id || params.get('new')) { const p = new URLSearchParams(params); ['edit', 'new', 'content', 'name'].forEach(k => p.delete(k)); setParams(p, { replace: true }) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const cur = items[hl]
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }) }
  const mine = (s: Snippet) => s.user_id === user?.id || user?.role === 'admin'
  const use = async (s: Snippet) => { if (await useSnippet(s)) load() }
  const pin = async (s: Snippet) => { await api.put(`${V1}/snippets/${s.id}`, { pinned: !s.pinned }); toast(s.pinned ? 'Unpinned' : 'Pinned'); load() }
  const remove = async (s: Snippet) => { await api.del(`${V1}/snippets/${s.id}`); setDel(null); toast('Snippet deleted'); load(); reloadMeta() }
  const importFile = async (f: File) => {
    try { const r = await api.post<Record<string, number>>(`${V1}/import`, JSON.parse(await f.text())); toast(`Imported ${plural(r.snippets, 'snippet')}${r.quicklinks ? `, ${plural(r.quicklinks, 'quicklink')}` : ''}${r.skipped ? `, ${r.skipped} skipped` : ''}`); load(); reloadMeta() } catch (e) { toast((e as Error).message, 'err') }
  }
  const onKey = (e: React.KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl(h => Math.min(items.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(h => Math.max(0, h - 1)) }
    else if (e.key === 'Enter' && cur) { e.preventDefault(); if (meta) { copyText(cur.content); toast('Template copied') } else use(cur) }
    else if (e.key.toLowerCase() === 'e' && meta && cur) { e.preventDefault(); setEdit(cur) }
    else if (e.key.toLowerCase() === 'p' && meta && cur && mine(cur)) { e.preventDefault(); pin(cur) }
    else if (e.key === 'Escape' && q) set('q', '')
  }

  const detail = cur && (
    <div className="detail-body">
      <pre className="preview text"><Template text={cur.content} /></pre>
      <SnippetMeta s={cur} />
      <div className="row wrap mt">
        <button className="btn primary" onClick={() => use(cur)}>Copy expanded</button>
        <button className="btn" onClick={() => { copyText(cur.content); toast('Template copied') }}>Copy template</button>
        {mine(cur) && <><button className="btn" onClick={() => setEdit(cur)}>Edit</button><button className="btn" onClick={() => pin(cur)}>{cur.pinned ? 'Unpin' : 'Pin'}</button><button className="btn ghost sm danger-text" onClick={() => setDel(cur)}>Delete</button></>}
        {!mine(cur) && <button className="btn" onClick={() => setEdit({ name: cur.name, content: cur.content, folder: cur.folder })}>Duplicate to mine</button>}
      </div>
    </div>
  )

  return (
    <>
      <PageHeader title="Snippets" sub={`${plural(total, 'snippet')} · placeholders like {clipboard}, {date} and {argument name="x"} are filled in when you copy`} actions={<>
        <button className="btn" onClick={() => fileInput.current?.click()}>Import JSON</button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={e => e.target.files?.[0] && importFile(e.target.files[0])} />
        <a className="btn" href={`${V1}/export?what=snippets&bare=1`}>Export</a>
        <button className="btn primary" onClick={() => setEdit({})}>+ New snippet</button>
      </>} />
      <div className="palette page">
        <div className="pal-search">
          <span className="ico">⌕</span>
          <input value={q} onChange={e => set('q', e.target.value)} onKeyDown={onKey} placeholder="Search snippets by name, keyword or text…" autoFocus autoComplete="off" spellCheck={false} aria-label="Search snippets" />
          {q && <button className="btn ghost sm clear" onClick={() => set('q', '')} aria-label="Clear">✕</button>}
        </div>
        {folders.length > 0 && <div className="chips mb"><button className={`chip ${!folder ? 'active' : ''}`} onClick={() => set('folder', '')}>All</button>{folders.map(f => <button key={f} className={`chip ${folder === f ? 'active' : ''}`} onClick={() => set('folder', f)}>{f}</button>)}</div>}
        <div className={`pal-body ${cur ? 'has-detail' : ''}`}>
          <div className="pal-list" ref={list} role="listbox">
            {items.length === 0 && <div className="empty"><h3>{q ? 'No matches' : 'No snippets yet'}</h3><p className="muted">{q ? '' : 'Create one, or import a JSON array of snippets.'}</p></div>}
            {items.map((s, i) => <div key={s.id} data-i={i}><SnippetRow s={s} hl={i === hl} onClick={() => { setHl(i); if (narrow) setSheet(true) }} onDoubleClick={() => use(s)} /></div>)}
          </div>
          {!narrow && cur && <aside className="detail">{detail}</aside>}
        </div>
        <Hints items={[['↵', 'Copy expanded'], ['⌘↵', 'Copy template'], ['⌘E', 'Edit'], ['⌘P', 'Pin']]} />
      </div>
      {narrow && sheet && cur && <Modal title={cur.name} onClose={() => setSheet(false)}>{detail}</Modal>}
      {edit && <SnippetModal s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); reloadMeta() }} />}
      {del && <Confirm title={`Delete “${del.name}”?`} message="The snippet is removed for everyone it was shared with." onCancel={() => setDel(null)} onConfirm={() => remove(del)} />}
      {prompt}
    </>
  )
}

const PLACEHOLDERS: [string, string][] = [['{clipboard}', 'Clipboard contents'], ['{cursor}', 'Where the cursor ends up'], ['{date}', 'Today, 2026-10-15'], ['{time}', 'Now, 09:05'], ['{day}', 'Weekday name'], ['{date format="d MMMM yyyy"}', 'Formatted date'], ['{date offset="+1w" format="EEE"}', 'Date with offset'], ['{argument name="x" default="y"}', 'Ask when used'], ['{snippet name="Other"}', 'Nest a snippet'], ['{uuid}', 'Random UUID']]

function SnippetModal({ s, onClose, onSaved }: { s: Partial<Snippet>; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const { folders } = useApp()
  const [f, setF] = useState({ name: s.name || '', keyword: s.keyword || '', content: s.content || '', folder: s.folder || '', shared: s.shared || false, pinned: s.pinned || false })
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<ExpandResult | null>(null)
  const ta = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const [names, setNames] = useState<string[]>([])
  useEffect(() => { api.get<{ snippets: Snippet[] }>(`${V1}/snippets?limit=500`).then(r => setNames(r.snippets.map(x => x.name).filter(n => n !== s.name))).catch(() => {}) }, [s.name])
  const debounced = useDebounce(f.content, 250)
  useEffect(() => {
    if (!debounced.trim() || !/\{[^}]+\}/.test(debounced)) { setPreview(null); return }
    // Dry-run through a throwaway expansion: the API expands any snippet; we preview via a temporary one only if saved. Use client-side approximation for unsaved: ask server with id if present.
    if (s.id) api.post<ExpandResult>(`${V1}/snippets/${s.id}/expand?dry=1`, { args: {}, clipboard: '⟨clipboard⟩' }).then(setPreview).catch(() => setPreview(null))
    else setPreview(null)
  }, [debounced, s.id])
  const insert = (ph: string) => {
    const el = ta.current
    if (!el) { setF(x => ({ ...x, content: x.content + ph })); return }
    const a = el.selectionStart ?? f.content.length, b = el.selectionEnd ?? a
    const v = f.content.slice(0, a) + ph + f.content.slice(b)
    setF(x => ({ ...x, content: v }))
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + ph.length, a + ph.length) })
  }
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      if (s.id) await api.put(`${V1}/snippets/${s.id}`, f); else await api.post(`${V1}/snippets`, f)
      toast(s.id ? 'Snippet saved' : 'Snippet created'); onSaved()
    } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }
  return (
    <Modal title={s.id ? 'Edit snippet' : 'New snippet'} onClose={onClose} size="lg">
      <form onSubmit={save} className="grid" style={{ gap: 14 }}>
        <div className="two-col tight">
          <Field label="Name"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoFocus required maxLength={120} placeholder="Email signature" /></Field>
          <Field label="Keyword" help="Short trigger, no spaces. Also used by GET /api/v1/snippets/expand?keyword=…"><input value={f.keyword} onChange={e => setF({ ...f, keyword: e.target.value.replace(/\s+/g, '') })} maxLength={40} placeholder="sig" className="mono" /></Field>
        </div>
        <Field label="Content">
          <PlaceholderEditor inputRef={ta} value={f.content} onChange={v => setF(x => ({ ...x, content: v }))} completions={SNIPPET_COMPLETIONS} snippetNames={names} rows={8} required className="mono" />
          <div className="chips mt-sm">{PLACEHOLDERS.map(([ph, help]) => <button type="button" key={ph} className="chip sm mono" title={help} onClick={() => insert(ph)}>{ph}</button>)}</div>
          <span className="help">Type <code>{'{'}</code> for completions.</span>
        </Field>
        {preview && <div className="callout"><div className="muted small mb-sm">Preview with today's values</div><pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{preview.text}</pre>{preview.missing.length > 0 && <div className="muted small mt-sm">Asks for: {preview.missing.join(', ')}</div>}</div>}
        <div className="two-col tight">
          <Field label="Folder" help="Optional grouping, e.g. Work."><input value={f.folder} onChange={e => setF({ ...f, folder: e.target.value })} list="folders" maxLength={60} /><datalist id="folders">{folders.snippets.map(x => <option key={x} value={x} />)}</datalist></Field>
          <div className="grid" style={{ gap: 8, alignSelf: 'end' }}>
            <label className="row"><input type="checkbox" checked={f.shared} onChange={e => setF({ ...f, shared: e.target.checked })} style={{ width: 'auto' }} /> Share with other users (read-only for them)</label>
            <label className="row"><input type="checkbox" checked={f.pinned} onChange={e => setF({ ...f, pinned: e.target.checked })} style={{ width: 'auto' }} /> Pin to the top</label>
          </div>
        </div>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{s.id ? 'Save' : 'Create'}</button></div>
      </form>
    </Modal>
  )
}
