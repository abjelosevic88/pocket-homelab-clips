import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, V1 } from '../lib/api'
import type { Clip, Kind } from '../lib/types'
import { KINDS } from '../lib/types'
import { useActions } from '../lib/actions'
import { useApp } from '../lib/app-context'
import { copyText } from '../lib/clipboard'
import { plural } from '../lib/format'
import { ClipMeta, ClipPreview, ClipRow, Hints, KIND_LABEL, clipLabel, useMedia } from '../components/items'
import { Confirm, Field, Modal, PageHeader, useToast } from '../components/ui'

type Filter = 'all' | 'pinned' | Kind
const PAGE = 60

export default function Clipboard() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const filter = (params.get('kind') as Filter) || 'all'
  const [clips, setClips] = useState<Clip[]>([])
  const [total, setTotal] = useState(0)
  const [hl, setHl] = useState(0)
  const [sheet, setSheet] = useState(false)
  const [clear, setClear] = useState(false)
  const [editTitle, setEditTitle] = useState<Clip | null>(null)
  const [addText, setAddText] = useState(false)
  const narrow = useMedia('(max-width: 900px)')
  const { copyClip, prompt } = useActions()
  const { toast } = useToast()
  const { settings } = useApp()
  const navigate = useNavigate()
  const ctrl = useRef<AbortController | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const url = (offset: number) => `${V1}/clips?q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${offset}${filter === 'pinned' ? '&pinned=1' : filter !== 'all' ? `&kind=${filter}` : ''}`
  const load = useCallback(async () => {
    ctrl.current?.abort()
    const c = new AbortController(); ctrl.current = c
    try {
      const r = await fetch(url(0), { signal: c.signal, credentials: 'same-origin' })
      if (r.status === 401) window.dispatchEvent(new CustomEvent('pc:unauthorized'))
      const d = await r.json()
      if (!c.signal.aborted) { setClips(d.clips); setTotal(d.total); setHl(h => Math.min(h, Math.max(0, d.clips.length - 1))) }
    } catch (e) { if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'err') }
  }, [q, filter]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(load, q ? 60 : 0); return () => clearTimeout(t) }, [load, q])
  const more = async () => { const d = await api.get<{ clips: Clip[]; total: number }>(url(clips.length)); setClips(x => [...x, ...d.clips]); setTotal(d.total) }
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${hl}"]`)?.scrollIntoView({ block: 'nearest' }) }, [hl])

  const cur = clips[hl]
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }) }
  const patch = (c: Clip) => setClips(xs => xs.map(x => x.id === c.id ? c : x))

  const copy = async (c: Clip) => { const u = await copyClip(c); if (u) load() }
  const pin = async (c: Clip) => { patch(await api.put<Clip>(`${V1}/clips/${c.id}`, { pinned: !c.pinned })); toast(c.pinned ? 'Unpinned' : 'Pinned') }
  const del = async (c: Clip) => { await api.del(`${V1}/clips/${c.id}`); setClips(xs => xs.filter(x => x.id !== c.id)); setTotal(t => t - 1); toast('Deleted') }
  const openLink = (c: Clip) => window.open(c.content.startsWith('www.') ? 'https://' + c.content : c.content, '_blank', 'noopener')
  const saveSnippet = (c: Clip) => navigate(`/snippets?new=1&content=${encodeURIComponent(c.content)}&name=${encodeURIComponent(clipLabel(c).slice(0, 60))}`)
  const saveLink = (c: Clip) => navigate(`/quicklinks?new=1&link=${encodeURIComponent(c.content)}&name=${encodeURIComponent(c.title || '')}`)
  const clearAll = async () => { const r = await api.del<{ deleted: number }>(`${V1}/clips${filter !== 'all' && filter !== 'pinned' ? `?kind=${filter}` : ''}`); toast(`${plural(r.deleted, 'clip')} removed`); setClear(false); load() }
  const upload = async (f: File) => {
    const fd = new FormData(); fd.append('file', f); fd.append('source_app', 'Pocket Clips')
    const r = await fetch(`${V1}/clips`, { method: 'POST', body: fd, credentials: 'same-origin' })
    if (!r.ok) { toast((await r.json()).error || 'Upload failed', 'err'); return }
    toast('Image added'); load()
  }
  // Paste anywhere on the page adds a clip (text or image).
  useEffect(() => {
    const h = async (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')) return
      const img = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'))
      if (img) { const f = img.getAsFile(); if (f) { e.preventDefault(); upload(f) }; return }
      const text = e.clipboardData?.getData('text/plain')
      if (text?.trim()) { e.preventDefault(); await api.post(`${V1}/clips`, { content: text, source_app: 'Pocket Clips' }); toast('Clip added'); load() }
    }
    window.addEventListener('paste', h)
    return () => window.removeEventListener('paste', h)
  }, [load]) // eslint-disable-line react-hooks/exhaustive-deps

  const onKey = (e: React.KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl(h => Math.min(clips.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(h => Math.max(0, h - 1)) }
    else if (e.key === 'Enter' && cur) { e.preventDefault(); if (meta && cur.kind === 'link') openLink(cur); else copy(cur) }
    else if (e.key === 'Backspace' && meta && cur) { e.preventDefault(); del(cur) }
    else if (e.key.toLowerCase() === 'p' && meta && cur) { e.preventDefault(); pin(cur) }
    else if (e.key === 'Escape' && q) set('q', '')
  }

  const detail = cur && (
    <div className="detail-body">
      <ClipPreview c={cur} />
      <ClipMeta c={cur} />
      <div className="row wrap mt">
        <button className="btn primary" onClick={() => copy(cur)}>Copy</button>
        {cur.kind === 'link' && <button className="btn" onClick={() => openLink(cur)}>Open</button>}
        <button className="btn" onClick={() => pin(cur)}>{cur.pinned ? 'Unpin' : 'Pin'}</button>
        {cur.kind !== 'image' && <button className="btn" onClick={() => saveSnippet(cur)}>Save as snippet</button>}
        {cur.kind === 'link' && <button className="btn" onClick={() => saveLink(cur)}>Make quicklink</button>}
        <button className="btn ghost sm" onClick={() => setEditTitle(cur)}>Rename</button>
        <button className="btn ghost sm danger-text" onClick={() => del(cur)}>Delete</button>
      </div>
    </div>
  )

  return (
    <>
      <PageHeader title="Clipboard" sub={`${plural(total, 'clip')}${settings?.clip_retention_days ? ` · kept ${settings.clip_retention_days} days, pinned forever` : ''}`} actions={<>
        <button className="btn" onClick={() => setAddText(true)}>+ Text</button>
        <button className="btn" onClick={() => fileInput.current?.click()}>+ Image</button>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
        <button className="btn ghost danger-text" onClick={() => setClear(true)} disabled={!total}>Clear history</button>
      </>} />
      <div className="palette page">
        <div className="pal-search">
          <span className="ico">⌕</span>
          <input value={q} onChange={e => set('q', e.target.value)} onKeyDown={onKey} placeholder="Search your clipboard history…" autoFocus autoComplete="off" spellCheck={false} aria-label="Search clips" />
          {q && <button className="btn ghost sm clear" onClick={() => set('q', '')} aria-label="Clear">✕</button>}
        </div>
        <div className="chips mb">
          {(['all', 'pinned', ...KINDS] as Filter[]).map(k => <button key={k} className={`chip ${filter === k ? 'active' : ''}`} onClick={() => set('kind', k === 'all' ? '' : k)}>{k === 'all' ? 'All' : k === 'pinned' ? '📌 Pinned' : KIND_LABEL[k] + 's'}</button>)}
        </div>
        <div className={`pal-body ${cur ? 'has-detail' : ''}`}>
          <div className="pal-list" ref={list} role="listbox">
            {clips.length === 0 && <div className="empty"><h3>{q ? 'No matches' : 'No clips yet'}</h3><p className="muted">{q ? 'Search matches word beginnings and substrings.' : 'Paste anything on this page to add it, or connect a clipboard watcher (Settings → Clients).'}</p></div>}
            {clips.map((c, i) => <div key={c.id} data-i={i} onMouseMove={() => hl !== i && setHl(i)}><ClipRow c={c} hl={i === hl} onClick={() => { setHl(i); if (narrow) setSheet(true) }} onDoubleClick={() => copy(c)} /></div>)}
            {clips.length < total && <button className="btn block mt-sm" onClick={more}>Show more ({total - clips.length} left)</button>}
          </div>
          {!narrow && cur && <aside className="detail">{detail}</aside>}
        </div>
        <Hints items={[['↵', 'Copy'], ['⌘↵', 'Open link'], ['⌘P', 'Pin'], ['⌘⌫', 'Delete'], ['⌘V', 'Add from clipboard']]} />
      </div>
      {narrow && sheet && cur && <Modal title="Clip" onClose={() => setSheet(false)}>{detail}</Modal>}
      {clear && <Confirm title="Clear clipboard history?" message={`Removes every unpinned ${filter !== 'all' && filter !== 'pinned' ? KIND_LABEL[filter].toLowerCase() + ' ' : ''}clip. Pinned clips stay.`} onCancel={() => setClear(false)} onConfirm={clearAll} />}
      {editTitle && <TitleModal c={editTitle} onClose={() => setEditTitle(null)} onSaved={c => { patch(c); setEditTitle(null) }} />}
      {addText && <AddTextModal onClose={() => setAddText(false)} onAdded={() => { setAddText(false); load() }} />}
      {prompt}
    </>
  )
}

function TitleModal({ c, onClose, onSaved }: { c: Clip; onClose: () => void; onSaved: (c: Clip) => void }) {
  const [t, setT] = useState(c.title)
  return (
    <Modal title="Rename clip" onClose={onClose}>
      <form className="grid" style={{ gap: 12 }} onSubmit={async e => { e.preventDefault(); onSaved(await api.put<Clip>(`${V1}/clips/${c.id}`, { title: t })) }}>
        <Field label="Title" help="A label for the list; the content itself never changes."><input value={t} onChange={e => setT(e.target.value)} autoFocus maxLength={200} /></Field>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
      </form>
    </Modal>
  )
}

function AddTextModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
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

export { copyText }
