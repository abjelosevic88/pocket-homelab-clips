import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, V1 } from '../lib/api'
import type { Quicklink } from '../lib/types'
import { useActions } from '../lib/actions'
import { useApp } from '../lib/app-context'
import { copyText } from '../lib/clipboard'
import { plural } from '../lib/format'
import { Favicon, Hints, QuicklinkMeta, QuicklinkRow, Template, useMedia } from '../components/items'
import { Confirm, Field, Modal, PageHeader, useToast } from '../components/ui'
import { PlaceholderEditor, QUICKLINK_COMPLETIONS } from '../components/PlaceholderEditor'

export default function Quicklinks() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const folder = params.get('folder') || ''
  const [items, setItems] = useState<Quicklink[]>([])
  const [total, setTotal] = useState(0)
  const [hl, setHl] = useState(0)
  const [sheet, setSheet] = useState(false)
  const [edit, setEdit] = useState<Partial<Quicklink> | null>(null)
  const [del, setDel] = useState<Quicklink | null>(null)
  const narrow = useMedia('(max-width: 900px)')
  const { openQuicklink, prompt } = useActions()
  const { toast } = useToast()
  const { user, folders: allFolders, reloadMeta } = useApp()
  const folders = allFolders.quicklinks
  const ctrl = useRef<AbortController | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    ctrl.current?.abort()
    const c = new AbortController(); ctrl.current = c
    try {
      const r = await fetch(`${V1}/quicklinks?q=${encodeURIComponent(q)}&folder=${encodeURIComponent(folder)}&limit=300`, { signal: c.signal, credentials: 'same-origin' })
      if (r.status === 401) window.dispatchEvent(new CustomEvent('pc:unauthorized'))
      const d = await r.json()
      if (!c.signal.aborted) { setItems(d.quicklinks); setTotal(d.total); setHl(h => Math.min(h, Math.max(0, d.quicklinks.length - 1))) }
    } catch (e) { if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'err') }
  }, [q, folder]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(load, q ? 60 : 0); return () => clearTimeout(t) }, [load, q])
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${hl}"]`)?.scrollIntoView({ block: 'nearest' }) }, [hl])
  useEffect(() => {
    const id = params.get('edit')
    if (id) api.get<Quicklink>(`${V1}/quicklinks/${id}`).then(setEdit).catch(() => {})
    if (params.get('new')) setEdit({ link: params.get('link') || '', name: params.get('name') || '' })
    if (id || params.get('new')) { const p = new URLSearchParams(params); ['edit', 'new', 'link', 'name'].forEach(k => p.delete(k)); setParams(p, { replace: true }) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const cur = items[hl]
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }) }
  const mine = (x: Quicklink) => x.user_id === user?.id || user?.role === 'admin'
  const open = async (x: Quicklink) => { if (await openQuicklink(x)) load() }
  const pin = async (x: Quicklink) => { await api.put(`${V1}/quicklinks/${x.id}`, { pinned: !x.pinned }); toast(x.pinned ? 'Unpinned' : 'Pinned'); load() }
  const remove = async (x: Quicklink) => { await api.del(`${V1}/quicklinks/${x.id}`); setDel(null); toast('Quicklink deleted'); load(); reloadMeta() }
  const copyGo = (x: Quicklink) => { copyText(`${location.origin}/go/${x.keyword || x.id}?q=%s`); toast('Search-engine URL copied — add it to your browser with %s as the query') }
  const importFile = async (f: File) => {
    try { const r = await api.post<Record<string, number>>(`${V1}/import`, JSON.parse(await f.text())); toast(`Imported ${plural(r.quicklinks, 'quicklink')}${r.snippets ? `, ${plural(r.snippets, 'snippet')}` : ''}${r.skipped ? `, ${r.skipped} skipped` : ''}`); load(); reloadMeta() } catch (e) { toast((e as Error).message, 'err') }
  }
  const onKey = (e: React.KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl(h => Math.min(items.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(h => Math.max(0, h - 1)) }
    else if (e.key === 'Enter' && cur) { e.preventDefault(); if (meta) { copyText(cur.link); toast('Link copied') } else open(cur) }
    else if (e.key.toLowerCase() === 'e' && meta && cur) { e.preventDefault(); setEdit(cur) }
    else if (e.key.toLowerCase() === 'p' && meta && cur && mine(cur)) { e.preventDefault(); pin(cur) }
    else if (e.key === 'Escape' && q) set('q', '')
  }

  const detail = cur && (
    <div className="detail-body">
      <div className="preview row" style={{ gap: 12, alignItems: 'flex-start' }}><Favicon q={cur} size={28} /><code className="break"><Template text={cur.link} /></code></div>
      <QuicklinkMeta q={cur} />
      <div className="row wrap mt">
        <button className="btn primary" onClick={() => open(cur)}>Open</button>
        <button className="btn" onClick={() => { copyText(cur.link); toast('Link copied') }}>Copy link</button>
        {cur.arguments.length > 0 && <button className="btn" onClick={() => copyGo(cur)} title="Use this quicklink as a custom search engine in your browser">Copy search URL</button>}
        {mine(cur) && <><button className="btn" onClick={() => setEdit(cur)}>Edit</button><button className="btn" onClick={() => pin(cur)}>{cur.pinned ? 'Unpin' : 'Pin'}</button><button className="btn ghost sm danger-text" onClick={() => setDel(cur)}>Delete</button></>}
        {!mine(cur) && <button className="btn" onClick={() => setEdit({ name: cur.name, link: cur.link, icon: cur.icon, folder: cur.folder })}>Duplicate to mine</button>}
      </div>
    </div>
  )

  return (
    <>
      <PageHeader title="Quicklinks" sub={`${plural(total, 'quicklink')} · use {Query} or {argument name="x"} in the URL to be asked for input`} actions={<>
        <button className="btn" onClick={() => fileInput.current?.click()}>Import JSON</button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={e => e.target.files?.[0] && importFile(e.target.files[0])} />
        <a className="btn" href={`${V1}/export?what=quicklinks&raycast=1`}>Export</a>
        <button className="btn primary" onClick={() => setEdit({})}>+ New quicklink</button>
      </>} />
      <div className="palette page">
        <div className="pal-search">
          <span className="ico">⌕</span>
          <input value={q} onChange={e => set('q', e.target.value)} onKeyDown={onKey} placeholder="Search quicklinks by name, keyword or URL…" autoFocus autoComplete="off" spellCheck={false} aria-label="Search quicklinks" />
          {q && <button className="btn ghost sm clear" onClick={() => set('q', '')} aria-label="Clear">✕</button>}
        </div>
        {folders.length > 0 && <div className="chips mb"><button className={`chip ${!folder ? 'active' : ''}`} onClick={() => set('folder', '')}>All</button>{folders.map(f => <button key={f} className={`chip ${folder === f ? 'active' : ''}`} onClick={() => set('folder', f)}>{f}</button>)}</div>}
        <div className={`pal-body ${cur ? 'has-detail' : ''}`}>
          <div className="pal-list" ref={list} role="listbox">
            {items.length === 0 && <div className="empty"><h3>{q ? 'No matches' : 'No quicklinks yet'}</h3><p className="muted">{q ? '' : 'Create one, or import the JSON that Raycast exports (Quicklinks → Export).'}</p></div>}
            {items.map((x, i) => <div key={x.id} data-i={i}><QuicklinkRow q={x} hl={i === hl} onClick={() => { setHl(i); if (narrow) setSheet(true) }} onDoubleClick={() => open(x)} /></div>)}
          </div>
          {!narrow && cur && <aside className="detail">{detail}</aside>}
        </div>
        <Hints items={[['↵', 'Open'], ['⌘↵', 'Copy link'], ['⌘E', 'Edit'], ['⌘P', 'Pin']]} />
      </div>
      {narrow && sheet && cur && <Modal title={cur.name} onClose={() => setSheet(false)}>{detail}</Modal>}
      {edit && <QuicklinkModal x={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); reloadMeta() }} />}
      {del && <Confirm title={`Delete “${del.name}”?`} message="The quicklink is removed for everyone it was shared with." onCancel={() => setDel(null)} onConfirm={() => remove(del)} />}
      {prompt}
    </>
  )
}

function QuicklinkModal({ x, onClose, onSaved }: { x: Partial<Quicklink>; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const { folders } = useApp()
  const [f, setF] = useState({ name: x.name || '', keyword: x.keyword || '', link: x.link || '', icon: x.icon || '', open_with: x.open_with || '', folder: x.folder || '', shared: x.shared || false, pinned: x.pinned || false })
  const [busy, setBusy] = useState(false)
  const linkRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const insert = (ph: string) => {
    const el = linkRef.current
    const a = el?.selectionStart ?? f.link.length
    const v = f.link.slice(0, a) + ph + f.link.slice(el?.selectionEnd ?? a)
    setF(s => ({ ...s, link: v }))
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + ph.length, a + ph.length) })
  }
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      if (x.id) await api.put(`${V1}/quicklinks/${x.id}`, f); else await api.post(`${V1}/quicklinks`, f)
      toast(x.id ? 'Quicklink saved' : 'Quicklink created'); onSaved()
    } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }
  return (
    <Modal title={x.id ? 'Edit quicklink' : 'New quicklink'} onClose={onClose} size="lg">
      <form onSubmit={save} className="grid" style={{ gap: 14 }}>
        <Field label="Link" help={<>{'{Query}'} is asked for and URL-encoded when you open it. Several inputs: <code>{'{argument name="a"}'}</code> <code>{'{argument name="b" default="x"}'}</code>.</>}>
          <PlaceholderEditor inputRef={linkRef} multiline={false} value={f.link} onChange={v => setF(x => ({ ...x, link: v }))} completions={QUICKLINK_COMPLETIONS} autoFocus required className="mono" placeholder="https://www.google.com/search?q={Query}" />
          <div className="chips mt-sm"><button type="button" className="chip sm mono" onClick={() => insert('{Query}')}>{'{Query}'}</button><button type="button" className="chip sm mono" onClick={() => insert('{argument name="x" default=""}')}>{'{argument name="x"}'}</button><button type="button" className="chip sm mono" onClick={() => insert('{clipboard}')}>{'{clipboard}'}</button></div>
        </Field>
        <div className="two-col tight">
          <Field label="Name" help="Empty = the site's host name."><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} maxLength={120} placeholder="Google" /></Field>
          <Field label="Keyword" help="Makes /go/<keyword>?q=… work as a browser search engine."><input value={f.keyword} onChange={e => setF({ ...f, keyword: e.target.value.replace(/\s+/g, '') })} maxLength={40} placeholder="g" className="mono" /></Field>
        </div>
        <div className="three-col tight">
          <Field label="Icon" help="An emoji; empty = the site's favicon."><input value={f.icon} onChange={e => setF({ ...f, icon: e.target.value })} maxLength={8} placeholder="🔍" style={{ textAlign: 'center' }} /></Field>
          <Field label="Open with" help="Informational, for clients that pick an app."><input value={f.open_with} onChange={e => setF({ ...f, open_with: e.target.value })} maxLength={60} placeholder="Safari" /></Field>
          <Field label="Folder"><input value={f.folder} onChange={e => setF({ ...f, folder: e.target.value })} list="folders-ql" maxLength={60} /><datalist id="folders-ql">{folders.quicklinks.map(x => <option key={x} value={x} />)}</datalist></Field>
        </div>
        <div className="row wrap" style={{ gap: 18 }}>
          <label className="row"><input type="checkbox" checked={f.shared} onChange={e => setF({ ...f, shared: e.target.checked })} style={{ width: 'auto' }} /> Share with other users</label>
          <label className="row"><input type="checkbox" checked={f.pinned} onChange={e => setF({ ...f, pinned: e.target.checked })} style={{ width: 'auto' }} /> Pin to the top</label>
        </div>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{x.id ? 'Save' : 'Create'}</button></div>
      </form>
    </Modal>
  )
}
