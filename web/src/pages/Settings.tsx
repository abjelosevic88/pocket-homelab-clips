import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, V1 } from '../lib/api'
import { useApp } from '../lib/app-context'
import type { APIToken, Settings as SettingsT, User } from '../lib/types'
import { fmtBytes, fmtDateTime, plural } from '../lib/format'
import { Avatar, Confirm, Field, Loading, Modal, Segmented, SettingRow, Switch, Tabs, useAsync, useIsMobile, useToast } from '../components/ui'
import { Icon } from '../components/icons'
import { ShortcutsSheet } from '../components/ShortcutsSheet'

type TabId = 'general' | 'clients' | 'profile' | 'people' | 'tokens' | 'data' | 'about'

const TABS: { id: TabId; label: string; icon: string; sub: string }[] = [
  { id: 'general', label: 'General', icon: 'settings', sub: 'How long the clipboard history is kept, how big it may grow, and the app title.' },
  { id: 'clients', label: 'Clients', icon: 'smartphone', sub: 'Feed the history from your Mac, Linux box or iPhone, expand snippets from a shell, and use quicklinks as a browser search engine.' },
  { id: 'profile', label: 'Profile', icon: 'user', sub: 'Your name, email and password.' },
  { id: 'people', label: 'People', icon: 'users', sub: 'Everyone who has an account on this box.' },
  { id: 'tokens', label: 'API tokens', icon: 'key', sub: 'One token per device — a watcher, a Shortcut, a Homepage widget — so each can be revoked on its own.' },
  { id: 'data', label: 'Backup & data', icon: 'database', sub: 'Download the database, export your library, import a JSON file.' },
  { id: 'about', label: 'About', icon: 'info', sub: 'Version, numbers and the server.' },
]
// the old ?tab= names
const ALIAS: Record<string, TabId> = { users: 'people', api: 'tokens' }

export default function Settings() {
  const { tab: raw } = useParams()
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const legacy = new URLSearchParams(window.location.search).get('tab') || ''
  const want = raw || ALIAS[legacy] || legacy
  const tab: TabId = (TABS.find(t => t.id === (ALIAS[want] || want))?.id) || 'general'
  const current = TABS.find(t => t.id === tab)!
  const go = (id: TabId) => navigate(`/settings/${id}`, { replace: true })

  useEffect(() => { document.querySelector('.set-content')?.scrollTo({ top: 0 }) }, [tab])
  useEffect(() => { document.querySelector('.set-tabs-mobile .active')?.scrollIntoView({ block: 'nearest', inline: 'center' }) }, [tab, mobile])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.modal-backdrop, .menu, .sel-pop')) navigate('/') }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [navigate])

  return (
    <div className="set-page">
      <header className="set-header">
        <button type="button" className="btn ghost icon-only" aria-label="Back to Pocket Clips" title="Back (esc)" onClick={() => navigate('/')}><Icon name="chevron-left" size={18} /></button>
        <img src="/favicon.svg" alt="" width={24} height={24} className="set-logo" />
        <h1>Settings</h1>
      </header>
      {mobile && <div className="set-tabs-mobile"><Tabs tabs={TABS.map(t => ({ id: t.id, label: t.label, icon: t.icon }))} value={tab} onChange={go} /></div>}
      <div className="set-body">
        {!mobile && (
          <nav className="set-nav" aria-label="Settings sections">
            {TABS.map(t => (
              <button key={t.id} type="button" className={`set-nav-item ${t.id === tab ? 'active' : ''}`} aria-current={t.id === tab ? 'page' : undefined} onClick={() => go(t.id)}>
                <Icon name={t.icon} size={16} />{t.label}
              </button>
            ))}
          </nav>
        )}
        <main className="set-content">
          <div className="set-inner" key={tab}>
            <div className="set-title">
              <h2>{current.label}</h2>
              <p>{current.sub}</p>
            </div>
            {tab === 'general' && <General />}
            {tab === 'clients' && <Clients />}
            {tab === 'profile' && <Profile />}
            {tab === 'people' && <Users />}
            {tab === 'tokens' && <Tokens />}
            {tab === 'data' && <Data />}
            {tab === 'about' && <About />}
          </div>
        </main>
      </div>
    </div>
  )
}

/** A settings card: title, explanation, actions on the right — Pocket Calendar's section. */
function Section({ title, sub, icon, actions, children }: { title: React.ReactNode; sub?: React.ReactNode; icon?: string; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="set-section">
      <div className="set-section-head">
        {icon && <span className="set-app-ico"><Icon name={icon} size={17} /></span>}
        <div className="grow"><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
        {actions && <div className="row">{actions}</div>}
      </div>
      {children && <div className="set-section-body">{children}</div>}
    </section>
  )
}

const RETENTION = [[7, '1 week'], [30, '1 month'], [90, '3 months'], [180, '6 months'], [365, '1 year'], [0, 'Forever']] as const

function General() {
  const { settings, setSettings, user } = useApp()
  const { toast } = useToast()
  const [f, setF] = useState<SettingsT | null>(settings)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!f && settings) setF(settings) }, [settings]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return <Loading />
  const isAdmin = user?.role === 'admin'
  const save = async () => {
    setBusy(true)
    try { const s = await api.put<SettingsT>(`${V1}/settings`, f); setSettings(s); setF(s); toast('Saved') } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }
  const custom = !RETENTION.some(([d]) => d === f.clip_retention_days)
  return (
    <div className="stack loose">
      <Section title="Clipboard history" sub={isAdmin ? 'These apply to everyone on this box.' : 'Set by an admin for everyone.'}>
        <SettingRow stack title="Keep clipboard history for" help={<>Unpinned clips older than this are removed once an hour. Pinned clips are never removed.{custom && <> Currently {f.clip_retention_days} days (set via the API).</>}</>}>
          {isAdmin
            ? <Segmented value={custom ? -1 : f.clip_retention_days} onChange={v => setF({ ...f, clip_retention_days: v })} options={RETENTION.map(([d, l]) => ({ value: d, label: l }))} size="sm" label="Keep clipboard history for" />
            : <span className="muted">{RETENTION.find(([d]) => d === f.clip_retention_days)?.[1] || `${f.clip_retention_days} days`}</span>}
        </SettingRow>
        <SettingRow title="Maximum clips per person" help="The oldest unpinned clips go first when the limit is reached. 0 = unlimited.">
          <input type="number" min={0} max={1000000} value={f.max_clips} onChange={e => setF({ ...f, max_clips: Number(e.target.value) })} disabled={!isAdmin} style={{ width: 120 }} aria-label="Maximum clips per person" />
        </SettingRow>
        <SettingRow title="Look up the page title of copied links" help={f.link_titles_enabled ? 'One request per new link, in the background.' : 'Disabled on the server with LINK_TITLES=false.'}>
          <Switch checked={f.fetch_link_titles} onChange={v => setF({ ...f, fetch_link_titles: v })} disabled={!isAdmin || !f.link_titles_enabled} label="Look up the page title of copied links" />
        </SettingRow>
        <SettingRow title="App title" help="Shown in the sidebar and the browser tab.">
          <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} maxLength={40} disabled={!isAdmin} style={{ width: 220 }} aria-label="App title" />
        </SettingRow>
      </Section>
      {isAdmin && <div className="row"><button type="button" className="btn primary" onClick={save} disabled={busy}>Save changes</button></div>}
      <Section title="Limits and how it works">
        <dl className="set-dl">
          <div><dt>Text clip</dt><dd className="muted">up to {fmtBytes(f.max_clip_bytes)} (<code>MAX_CLIP_BYTES</code>)</dd></div>
          <div><dt>Image clip</dt><dd className="muted">up to {fmtBytes(f.max_image_bytes)} (<code>MAX_IMAGE_BYTES</code>)</dd></div>
          <div><dt>Duplicates</dt><dd className="muted">Copying the same content again moves the existing clip to the top and counts it; nothing is stored twice.</dd></div>
          <div><dt>Search</dt><dd className="muted">SQLite FTS5 over content, titles and app names; word-prefix matching with a substring fallback, so <code>inv num</code> and <code>ample</code> both find “Invoice number for Example”.</dd></div>
        </dl>
      </Section>
    </div>
  )
}

function Clients() {
  const { status } = useApp()
  const base = location.origin
  return (
    <div className="stack loose">
      <Section title="Feeding the clipboard history" icon="clipboard" sub={<>This is the server side. Something on each device has to send what you copy. Every call needs a token from <b>API tokens</b>; the full scripts are in the repository under <code>deploy/clients</code> and described in <code>docs/clients.md</code>.</>}>
        <div className="set-code">
          <h4>macOS — watch the pasteboard</h4>
          <pre>{`# deploy/clients/macos-clipboard-watch.sh — polls pbpaste every second, posts new content
POCKET_CLIPS_URL=${base} POCKET_CLIPS_TOKEN=pc_… ./macos-clipboard-watch.sh
# install as a LaunchAgent so it runs at login: see docs/clients.md`}</pre>
          <h4>Linux — Wayland or X11</h4>
          <pre>{`wl-paste --watch ./post-clip.sh          # Wayland (wl-clipboard)
clipnotify && xclip -o -selection clipboard | ./post-clip.sh   # X11, in a loop`}</pre>
          <h4>Anything with curl</h4>
          <pre>{`# text (kind is detected: link / colour / text)
pbpaste | curl -fsS -X POST ${base}/api/v1/clips?source_app=Terminal \\
  -H "Authorization: Bearer pc_…" -H "Content-Type: text/plain" --data-binary @-

# an image
curl -fsS -X POST ${base}/api/v1/clips -H "Authorization: Bearer pc_…" -F file=@shot.png -F source_app=Screenshot`}</pre>
          <h4>iOS Shortcut</h4>
          <p className="muted small">Get Clipboard → Get Contents of URL (POST, JSON <code>{'{"content": Clipboard, "source_device": "iPhone"}'}</code>, header <code>Authorization: Bearer pc_…</code>). Add it to the Share Sheet or run it from the Action button.</p>
        </div>
      </Section>
      <Section title="Snippets from anywhere" icon="scissors" sub="Expanded on the server, so every shell gets the same result.">
        <pre>{`# expanded text, arguments as arg.<name>
curl -fsS "${base}/api/v1/snippets/expand?keyword=sig&arg.name=Ana" \\
  -H "Authorization: Bearer pc_…" | pbcopy

# JSON with cursor offset and missing arguments
curl -fsS -X POST ${base}/api/v1/snippets/expand -H "Authorization: Bearer pc_…" \\
  -H "Content-Type: application/json" -d '{"keyword":"mtg","args":{"attendees":"Ana"}}'`}</pre>
      </Section>
      <Section title="Quicklinks as a browser search engine" icon="zap" sub={<>Any quicklink with a <code>{'{Query}'}</code> gets a redirect URL. Add it in your browser's search-engine settings with <code>%s</code> as the query, give it the same keyword, and type <code>g pocket clips</code> in the address bar.</>}>
        <pre>{`${base}/go/g?q=%s        # by keyword
${base}/go/12?q=%s       # by id`}</pre>
        <p className="muted small mt-sm">Works while you are signed in here (session cookie){status?.auth_mode === 'none' ? ' — or always, since login is off' : ''}.</p>
      </Section>
    </div>
  )
}

function Users() {
  const { user, users, reloadMeta, status } = useApp()
  const { toast } = useToast()
  const [edit, setEdit] = useState<Partial<User> | null>(null)
  const [del, setDel] = useState<User | null>(null)
  const isAdmin = user?.role === 'admin'
  const run = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); await reloadMeta(); toast(msg) } catch (e) { toast((e as Error).message, 'err') } }
  return (
    <Section title="People on this box" actions={isAdmin && <button type="button" className="btn primary sm" onClick={() => setEdit({ role: 'member' })}><Icon name="plus" size={14} />Add person</button>} sub="Everyone signs in with their own account. Clipboard history is strictly per person. Snippets and quicklinks are private unless their owner marks them shared; shared items are read-only for others. Admins manage accounts and the box-wide settings.">
      <div className="set-people">
        {users.map(u => (
          <div key={u.id} className="set-person">
            <Avatar name={u.name} email={u.email} size={34} />
            <div className="grow">
              <div className="set-person-name">{u.name || <span className="muted">—</span>}{u.id === user?.id && <span className="badge">you</span>}{u.role === 'admin' && <span className="badge accent">admin</span>}</div>
              <div className="muted small ellipsis">{u.email}</div>
            </div>
            {isAdmin && <span className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn ghost sm" onClick={() => setEdit(u)}>Edit</button>{u.id !== user?.id && <button type="button" className="btn ghost sm danger-text" onClick={() => setDel(u)}>Remove</button>}</span>}
          </div>
        ))}
      </div>
      {status?.auth_mode !== 'local' && <p className="muted small mt">Auth mode is <code>{status?.auth_mode}</code>: users are created automatically on first visit; passwords are not used here.</p>}
      {edit && <UserModal user={edit} local={status?.auth_mode === 'local'} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reloadMeta() }} />}
      {del && <Confirm confirmLabel="Remove" title={`Remove ${del.name || del.email}?`} message="Their account, clipboard history, snippets and quicklinks are deleted." onCancel={() => setDel(null)} onConfirm={() => { const d = del; setDel(null); run(() => api.del(`${V1}/users/${d.id}`), 'User removed') }} />}
    </Section>
  )
}

function UserModal({ user, local, onClose, onSaved }: { user: Partial<User>; local: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const [f, setF] = useState({ name: user.name || '', email: user.email || '', password: '', role: user.role || 'member' })
  const [busy, setBusy] = useState(false)
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try { if (user.id) await api.put(`${V1}/users/${user.id}`, f); else await api.post(`${V1}/users`, f); toast(user.id ? 'User saved' : 'User added'); onSaved() } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }
  return (
    <Modal title={user.id ? 'Edit person' : 'Add a person'} onClose={onClose} size="sm">
      <form onSubmit={save} className="grid" style={{ gap: 14 }}>
        <Field label="Name"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoFocus required maxLength={60} /></Field>
        <Field label="Email" help="Used to sign in."><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required /></Field>
        {local && <Field label={user.id ? 'New password (leave empty to keep)' : 'Password'} help="At least 8 characters. Tell them to change it under Settings → Profile."><input type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} minLength={user.id ? 0 : 8} required={!user.id} autoComplete="new-password" /></Field>}
        <Field group label="Role"><Segmented value={f.role} onChange={v => setF({ ...f, role: v })} options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]} /></Field>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{user.id ? 'Save' : 'Add person'}</button></div>
      </form>
    </Modal>
  )
}

function Profile() {
  const { user, setUser, status } = useApp()
  const { toast } = useToast()
  const [f, setF] = useState({ name: user?.name || '', email: user?.email || '', current_password: '', new_password: '' })
  const [busy, setBusy] = useState(false)
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try { setUser(await api.put(`${V1}/auth/me`, f)); setF(x => ({ ...x, current_password: '', new_password: '' })); toast('Profile saved') } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }
  return (
    <form onSubmit={save} className="stack loose">
      <div className="set-profile">
        <Avatar name={user?.name} email={user?.email} size={56} />
        <div className="grow"><h3>{user?.name || user?.email}</h3><p className="muted small">{user?.email} · {user?.role}</p></div>
      </div>
      <Section title="You">
        <div className="stack">
          <Field label="Name" help="Shown to others next to the snippets and quicklinks you share."><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email"><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        </div>
      </Section>
      {status?.auth_mode === 'local' && <Section title="Password" sub="Leave empty to keep the current one."><div className="stack">
        <Field label="Current password"><input type="password" value={f.current_password} onChange={e => setF({ ...f, current_password: e.target.value })} autoComplete="current-password" /></Field>
        <Field label="New password" help="At least 8 characters."><input type="password" value={f.new_password} onChange={e => setF({ ...f, new_password: e.target.value })} autoComplete="new-password" /></Field>
      </div></Section>}
      <div className="row"><button className="btn primary" disabled={busy}>Save changes</button></div>
    </form>
  )
}

function Tokens() {
  const { toast } = useToast()
  const { data, reload } = useAsync(() => api.get<APIToken[]>(`${V1}/tokens`), [])
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState('')
  const [del, setDel] = useState<APIToken | null>(null)
  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    try { const r = await api.post<{ token: string }>(`${V1}/tokens`, { name: name || 'token' }); setFresh(r.token); setName(''); reload() } catch (e) { toast((e as Error).message, 'err') }
  }
  return (
    <div className="stack loose">
      <Section title="Personal tokens" icon="key" sub={<>Use as <code>Authorization: Bearer &lt;token&gt;</code>. A token acts as you: it can add clips (<code>POST /api/v1/clips</code>), expand snippets, open quicklinks and feed a Homepage widget (<code>GET /api/v1/dashboard</code>). See <code>docs/api.md</code>.</>}>
        <form onSubmit={create} className="row mb"><input value={name} onChange={e => setName(e.target.value)} placeholder="Token name (e.g. MacBook watcher)" aria-label="Token name" /><button className="btn primary"><Icon name="plus" size={15} />Create</button></form>
        {fresh && <div className="set-fresh mb"><div className="row"><Icon name="check-circle" size={16} /><b>Copy it now — it is shown once.</b></div><pre className="mono">{fresh}</pre></div>}
        {data && data.length > 0 ? (
          <table className="table compact">
            <thead><tr><th>Name</th><th>Prefix</th><th>Last used</th><th>Created</th><th /></tr></thead>
            <tbody>{data.map(t => <tr key={t.id}><td>{t.name}</td><td className="mono">{t.prefix}…</td><td className="muted">{t.last_used_at ? fmtDateTime(t.last_used_at) : 'never'}</td><td className="muted">{fmtDateTime(t.created_at)}</td><td className="right"><button type="button" className="btn ghost sm danger-text" onClick={() => setDel(t)}>Revoke</button></td></tr>)}</tbody>
          </table>
        ) : <p className="muted">No tokens yet.</p>}
        {del && <Confirm confirmLabel="Revoke" title={`Revoke “${del.name}”?`} message="Anything using this token stops working immediately." onCancel={() => setDel(null)} onConfirm={async () => { await api.del(`${V1}/tokens/${del.id}`); setDel(null); reload() }} />}
      </Section>
    </div>
  )
}

function Data() {
  const { toast } = useToast()
  const { reloadMeta, user } = useApp()
  const isAdmin = user?.role === 'admin'
  const [busy, setBusy] = useState(false)
  const importJSON = async (file: File) => {
    setBusy(true)
    try { const r = await api.post<Record<string, number>>(`${V1}/import`, JSON.parse(await file.text())); toast(`Imported ${plural(r.snippets, 'snippet')}, ${plural(r.quicklinks, 'quicklink')}, ${plural(r.clips, 'clip')}${r.skipped ? `, ${r.skipped} skipped` : ''}`); reloadMeta() } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }
  return (
    <div className="stack loose">
      {isAdmin && <Section title="Database backup" icon="database" sub="Admins only.">
        <p className="muted">A consistent copy of the SQLite database (<code>VACUUM INTO</code>) with every user's clips, snippets and quicklinks. Images live next to it under <code>images/</code>. Restore by stopping the app and replacing <code>pocket-clips.db</code> in the data directory.</p>
        <a className="btn primary" href={`${V1}/backup`}><Icon name="download" size={15} />Download database</a>
      </Section>}
      <Section title="Export & import" icon="archive" sub="Your snippets and quicklinks as one JSON file (add your text clips with the second button). The same file, a Raycast export, or a bare array of snippets or quicklinks imports here; items you already have are skipped.">
        <div className="row wrap">
          <a className="btn" href={`${V1}/export`}><Icon name="download" size={15} />Export library</a>
          <a className="btn" href={`${V1}/export?clips=1`}><Icon name="download" size={15} />Export library + clips</a>
          <label className="btn"><Icon name="upload" size={15} />{busy ? 'Importing…' : 'Import JSON…'}<input type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importJSON(f) }} /></label>
        </div>
      </Section>
    </div>
  )
}

function About() {
  const { data, error } = useAsync(() => api.get<Record<string, unknown>>(`${V1}/settings/system`), [])
  const [keys, setKeys] = useState(false)
  if (error) return <div className="callout danger"><Icon name="alert" size={15} /><span>{error}</span></div>
  if (!data) return <Loading />
  const counts = (data.counts || {}) as Record<string, number>
  const tiles: [string, number | undefined, string][] = [['Clips', counts.clips, 'clipboard'], ['Snippets', counts.snippets, 'scissors'], ['Quicklinks', counts.quicklinks, 'zap']]
  if (data.admin === true) tiles.push(['People', Number((data.box_counts as Record<string, number> | undefined)?.users ?? 0), 'users'])
  const rows: [string, React.ReactNode][] = [
    ['Version', <code key="v">{String(data.version)}</code>],
    ['Uptime', String(data.uptime)],
    ['Runtime', `${String(data.go)} · ${String(data.os)}/${String(data.arch)}`],
    ['Time zone', String(data.timezone)],
    ['Sign-in', String(data.auth_mode)],
  ]
  if (data.admin === true) rows.push(['Database', <span key="db"><code>{String(data.db_path)}</code> · {fmtBytes(Number(data.db_bytes))} · images {fmtBytes(Number(data.images_bytes))}</span>])
  return (
    <div className="stack loose">
      <div className="set-about-hero">
        <img src="/favicon.svg" alt="" width={48} height={48} />
        <div>
          <h3>Pocket Clips</h3>
          <p className="muted small">A self-hosted clipboard history, snippet library and quicklink launcher: everything you copy, searchable from any device, with snippets that expand placeholders and quicklinks that take a query — part of the Pocket apps. Favicons by DuckDuckGo.</p>
        </div>
      </div>
      <div className="set-stats">
        {tiles.map(([label, n, icon]) => (
          <div key={label} className="set-stat"><Icon name={icon} size={16} /><span className="set-stat-n tnum">{(n ?? 0).toLocaleString()}</span><span className="set-stat-l">{label}</span></div>
        ))}
      </div>
      <Section title="This server">
        <dl className="set-dl">
          {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </Section>
      <div className="row wrap">
        <button type="button" className="btn" onClick={() => setKeys(true)}><Icon name="keyboard" size={15} />Keyboard shortcuts</button>
        <a className="btn" href="https://github.com/abjelosevic88/pocket-homelab-clips" target="_blank" rel="noreferrer"><Icon name="external" size={15} />Project on GitHub</a>
      </div>
      {keys && <ShortcutsSheet onClose={() => setKeys(false)} />}
    </div>
  )
}
