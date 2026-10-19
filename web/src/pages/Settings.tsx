import { useEffect, useState } from 'react'
import { api, V1 } from '../lib/api'
import { useApp } from '../lib/app-context'
import type { APIToken, Settings as SettingsT, User } from '../lib/types'
import { fmtBytes, fmtDateTime, plural } from '../lib/format'
import { Card, Confirm, Field, Loading, Modal, PageHeader, Segmented, Tabs, useAsync, useToast } from '../components/ui'
import { Avatar } from '../components/people'

type Tab = 'general' | 'clients' | 'users' | 'profile' | 'api' | 'data' | 'about'

export default function Settings() {
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(window.location.search).get('tab') as Tab) || 'general')
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs tabs={[{ id: 'general', label: 'General' }, { id: 'clients', label: 'Clients' }, { id: 'users', label: 'Users' }, { id: 'profile', label: 'Profile' }, { id: 'api', label: 'API tokens' }, { id: 'data', label: 'Backup & data' }, { id: 'about', label: 'About' }]} value={tab} onChange={setTab} />
      <div className="mt">
        {tab === 'general' && <General />}
        {tab === 'clients' && <Clients />}
        {tab === 'users' && <Users />}
        {tab === 'profile' && <Profile />}
        {tab === 'api' && <Tokens />}
        {tab === 'data' && <Data />}
        {tab === 'about' && <About />}
      </div>
    </>
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
    <div className="two-col">
      <Card title="Preferences">
        <div className="grid" style={{ gap: 14 }}>
          <Field label="App title" help="Shown in the sidebar and browser tab."><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} maxLength={40} disabled={!isAdmin} /></Field>
          <Field group label="Keep clipboard history for" help="Unpinned clips older than this are removed once an hour. Pinned clips are never removed.">
            <Segmented value={custom ? -1 : f.clip_retention_days} onChange={v => setF({ ...f, clip_retention_days: v })} options={RETENTION.map(([d, l]) => ({ value: d, label: l }))} size="sm" />
            {custom && <span className="muted small">Currently {f.clip_retention_days} days (set via API).</span>}
          </Field>
          <Field label="Maximum clips per user" help="Oldest unpinned clips go first when the limit is reached. 0 = unlimited."><input type="number" min={0} max={1000000} value={f.max_clips} onChange={e => setF({ ...f, max_clips: Number(e.target.value) })} disabled={!isAdmin} style={{ width: 140 }} /></Field>
          <label className="row"><input type="checkbox" checked={f.fetch_link_titles} onChange={e => setF({ ...f, fetch_link_titles: e.target.checked })} style={{ width: 'auto' }} disabled={!isAdmin || !f.link_titles_enabled} /> Look up the page title of copied links{!f.link_titles_enabled && <span className="muted small"> (disabled on the server with LINK_TITLES=false)</span>}</label>
          {isAdmin ? <div><button className="btn primary" onClick={save} disabled={busy}>Save</button></div> : <p className="muted small">Only an admin can change these.</p>}
        </div>
      </Card>
      <Card title="Limits">
        <table className="table compact">
          <tbody>
            <tr><th>Text clip</th><td className="muted">up to {fmtBytes(f.max_clip_bytes)} (<code>MAX_CLIP_BYTES</code>)</td></tr>
            <tr><th>Image clip</th><td className="muted">up to {fmtBytes(f.max_image_bytes)} (<code>MAX_IMAGE_BYTES</code>)</td></tr>
            <tr><th>Duplicates</th><td className="muted">Copying the same content again moves the existing clip to the top and counts it; nothing is stored twice.</td></tr>
            <tr><th>Search</th><td className="muted">SQLite FTS5 over content, titles and app names; word-prefix matching with a substring fallback, so <code>inv num</code> and <code>ample</code> both find “Invoice number for Example”.</td></tr>
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function Clients() {
  const { status } = useApp()
  const base = location.origin
  return (
    <div className="grid" style={{ gap: 16 }}>
      <Card title="Feeding the clipboard history">
        <p className="muted">This is the server side. Something on each device has to send what you copy. Every call needs a token from <b>Settings → API tokens</b>; the full scripts are in the repository under <code>deploy/clients</code> and described in <code>docs/clients.md</code>.</p>
        <h3 className="mt">macOS — watch the pasteboard</h3>
        <pre>{`# deploy/clients/macos-clipboard-watch.sh — polls pbpaste every second, posts new content
POCKET_CLIPS_URL=${base} POCKET_CLIPS_TOKEN=pc_… ./macos-clipboard-watch.sh
# install as a LaunchAgent so it runs at login: see docs/clients.md`}</pre>
        <h3 className="mt">Linux — Wayland or X11</h3>
        <pre>{`wl-paste --watch ./post-clip.sh          # Wayland (wl-clipboard)
clipnotify && xclip -o -selection clipboard | ./post-clip.sh   # X11, in a loop`}</pre>
        <h3 className="mt">Anything with curl</h3>
        <pre>{`# text (kind is detected: link / colour / text)
pbpaste | curl -fsS -X POST ${base}/api/v1/clips?source_app=Terminal \\
  -H "Authorization: Bearer pc_…" -H "Content-Type: text/plain" --data-binary @-

# an image
curl -fsS -X POST ${base}/api/v1/clips -H "Authorization: Bearer pc_…" -F file=@shot.png -F source_app=Screenshot`}</pre>
        <h3 className="mt">iOS Shortcut</h3>
        <p className="muted small">Get Clipboard → Get Contents of URL (POST, JSON <code>{'{"content": Clipboard, "source_device": "iPhone"}'}</code>, header <code>Authorization: Bearer pc_…</code>). Add it to the Share Sheet or run it from the Action button.</p>
      </Card>
      <div className="two-col">
        <Card title="Snippets from anywhere">
          <pre>{`# expanded text, arguments as arg.<name>
curl -fsS "${base}/api/v1/snippets/expand?keyword=sig&arg.name=Ana" \\
  -H "Authorization: Bearer pc_…" | pbcopy

# JSON with cursor offset and missing arguments
curl -fsS -X POST ${base}/api/v1/snippets/expand -H "Authorization: Bearer pc_…" \\
  -H "Content-Type: application/json" -d '{"keyword":"mtg","args":{"attendees":"Ana"}}'`}</pre>
        </Card>
        <Card title="Quicklinks as a browser search engine">
          <p className="muted">Any quicklink with a <code>{'{Query}'}</code> gets a redirect URL. Add it in your browser's search-engine settings with <code>%s</code> as the query, give it the same keyword, and type <code>g pocket clips</code> in the address bar:</p>
          <pre>{`${base}/go/g?q=%s        # by keyword
${base}/go/12?q=%s       # by id`}</pre>
          <p className="muted small">Works while you are signed in here (session cookie){status?.auth_mode === 'none' ? ' — or always, since login is off' : ''}.</p>
        </Card>
      </div>
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
    <Card title="Users" actions={isAdmin && <button className="btn primary sm" onClick={() => setEdit({ role: 'member' })}>+ Add user</button>}>
      <p className="muted">Everyone signs in with their own account. Clipboard history is strictly per user. Snippets and quicklinks are private unless their owner marks them shared; shared items are read-only for others. Admins manage users and the shared settings.</p>
      <table className="table compact">
        <thead><tr><th /><th>Name</th><th>Email</th><th>Role</th><th /></tr></thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td style={{ width: 32 }}><Avatar user={u} /></td>
              <td>{u.name || <span className="muted">—</span>}{u.id === user?.id && <span className="badge" style={{ marginLeft: 6 }}>you</span>}</td>
              <td className="muted">{u.email}</td>
              <td><span className={`badge ${u.role === 'admin' ? 'cat' : ''}`}>{u.role}</span></td>
              <td className="right">{isAdmin && <span className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost sm" onClick={() => setEdit(u)}>Edit</button>{u.id !== user?.id && <button className="btn ghost sm danger-text" onClick={() => setDel(u)}>Remove</button>}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {status?.auth_mode !== 'local' && <p className="muted small mt">Auth mode is <code>{status?.auth_mode}</code>: users are created automatically on first visit; passwords are not used here.</p>}
      {edit && <UserModal user={edit} local={status?.auth_mode === 'local'} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reloadMeta() }} />}
      {del && <Confirm title={`Remove ${del.name || del.email}?`} message="Their account, clipboard history, snippets and quicklinks are deleted." onCancel={() => setDel(null)} onConfirm={() => { const d = del; setDel(null); run(() => api.del(`${V1}/users/${d.id}`), 'User removed') }} />}
    </Card>
  )
}

function UserModal({ user, local, onClose, onSaved }: { user: Partial<User>; local: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const [f, setF] = useState({ name: user.name || '', email: user.email || '', password: '', role: user.role || 'member' })
  const [busy, setBusy] = useState(false)
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      if (user.id) await api.put(`${V1}/users/${user.id}`, f); else await api.post(`${V1}/users`, f)
      toast(user.id ? 'User saved' : 'User added'); onSaved()
    } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }
  return (
    <Modal title={user.id ? 'Edit user' : 'Add user'} onClose={onClose}>
      <form onSubmit={save} className="grid" style={{ gap: 14 }}>
        <Field label="Name"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoFocus required maxLength={60} /></Field>
        <Field label="Email" help="Used to sign in."><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required /></Field>
        {local && <Field label={user.id ? 'New password (leave empty to keep)' : 'Password'} help="At least 8 characters. Tell them to change it under Settings → Profile."><input type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} minLength={user.id ? 0 : 8} required={!user.id} autoComplete="new-password" /></Field>}
        <Field group label="Role"><Segmented value={f.role} onChange={v => setF({ ...f, role: v })} options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]} /></Field>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{user.id ? 'Save' : 'Add user'}</button></div>
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
    <Card title="Profile">
      <form onSubmit={save} className="grid" style={{ gap: 14, maxWidth: 480 }}>
        <Field label="Name" help="Shown to others next to the snippets and quicklinks you share."><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        {status?.auth_mode === 'local' && <>
          <hr />
          <Field label="Current password"><input type="password" value={f.current_password} onChange={e => setF({ ...f, current_password: e.target.value })} autoComplete="current-password" /></Field>
          <Field label="New password" help="At least 8 characters. Leave empty to keep the current one."><input type="password" value={f.new_password} onChange={e => setF({ ...f, new_password: e.target.value })} autoComplete="new-password" /></Field>
        </>}
        <div><button className="btn primary" disabled={busy}>Save</button></div>
      </form>
    </Card>
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
    <Card title="API tokens">
      <p className="muted">Use as <code>Authorization: Bearer &lt;token&gt;</code>. A token acts as you: it can add clips (<code>POST /api/v1/clips</code>), expand snippets, open quicklinks and feed a Homepage widget (<code>GET /api/v1/dashboard</code>). One token per device makes revoking easy. See <code>docs/api.md</code>.</p>
      <form onSubmit={create} className="row mb"><input value={name} onChange={e => setName(e.target.value)} placeholder="Token name (e.g. MacBook watcher)" /><button className="btn primary">Create</button></form>
      {fresh && <div className="callout success mb"><b>Copy it now — it is shown once.</b><pre className="mono" style={{ margin: '8px 0 0' }}>{fresh}</pre></div>}
      {data && data.length > 0 ? (
        <table className="table compact">
          <thead><tr><th>Name</th><th>Prefix</th><th>Last used</th><th>Created</th><th /></tr></thead>
          <tbody>{data.map(t => <tr key={t.id}><td>{t.name}</td><td className="mono">{t.prefix}…</td><td className="muted">{t.last_used_at ? fmtDateTime(t.last_used_at) : 'never'}</td><td className="muted">{fmtDateTime(t.created_at)}</td><td className="right"><button className="btn ghost sm danger-text" onClick={() => setDel(t)}>Revoke</button></td></tr>)}</tbody>
        </table>
      ) : <p className="muted">No tokens yet.</p>}
      {del && <Confirm title={`Revoke “${del.name}”?`} message="Anything using this token stops working immediately." onCancel={() => setDel(null)} onConfirm={async () => { await api.del(`${V1}/tokens/${del.id}`); setDel(null); reload() }} />}
    </Card>
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
    <div className="two-col">
      {isAdmin && <Card title="Backup">
        <p className="muted">A consistent copy of the SQLite database (<code>VACUUM INTO</code>) with every user's clips, snippets and quicklinks. Images live next to it under <code>images/</code>. Restore by stopping the app and replacing <code>pocket-clips.db</code> in the data directory. Admins only.</p>
        <a className="btn primary" href={`${V1}/backup`}>Download database</a>
      </Card>}
      <Card title="Export & import">
        <p className="muted">Your snippets and quicklinks as one JSON file (add your text clips with the second button). The same file, or a bare array of snippets or quicklinks, imports here; items you already have are skipped.</p>
        <div className="row wrap">
          <a className="btn" href={`${V1}/export`}>Export library</a>
          <a className="btn" href={`${V1}/export?clips=1`}>Export library + clips</a>
          <label className="btn">{busy ? 'Importing…' : 'Import JSON…'}<input type="file" accept="application/json,.json" hidden onChange={e => e.target.files?.[0] && importJSON(e.target.files[0])} /></label>
        </div>
      </Card>
    </div>
  )
}

function About() {
  const { data } = useAsync(() => api.get<Record<string, unknown>>(`${V1}/settings/system`), [])
  const counts = (data?.counts || {}) as Record<string, number>
  return (
    <Card title="About">
      <p><b>Pocket Clips</b> is a self-hosted clipboard history, snippet library and quicklink launcher: everything you copy, searchable from any device, with snippets that expand placeholders and quicklinks that take a query. One binary, one SQLite file, one volume.</p>
      <p className="muted small">Open source (MIT) — <a href="https://github.com/abjelosevic88/pocket-homelab-clips" target="_blank" rel="noreferrer">github.com/abjelosevic88/pocket-homelab-clips</a>. Sibling projects: Pocket Habits, Pocket Inventory, Pocket Bookshelf, Pocket Split, Pocket Subtitles and Pocket Invoicing. Favicons by DuckDuckGo.</p>
      {data && (
        <table className="table compact mt">
          <tbody>
            <tr><th>Version</th><td className="mono">{String(data.version)}</td></tr>
            <tr><th>Runtime</th><td className="mono">{String(data.go)} · {String(data.os)}/{String(data.arch)}</td></tr>
            <tr><th>Auth mode</th><td className="mono">{String(data.auth_mode)}</td></tr>
            {data.admin === true && <tr><th>Database</th><td className="mono">{String(data.db_path)} · {fmtBytes(Number(data.db_bytes))} · images {fmtBytes(Number(data.images_bytes))}</td></tr>}
            <tr><th>Timezone</th><td className="mono">{String(data.timezone)}</td></tr>
            <tr><th>Uptime</th><td className="mono">{String(data.uptime)}</td></tr>
            <tr><th>Your rows</th><td className="mono">{counts.clips} clips · {counts.snippets} snippets · {counts.quicklinks} quicklinks</td></tr>
            {data.admin === true && <tr><th>Users</th><td className="mono">{Number((data.box_counts as Record<string, number> | undefined)?.users ?? 0)}</td></tr>}
          </tbody>
        </table>
      )}
    </Card>
  )
}
