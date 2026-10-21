// Left column: New button, sections with counts, clip kinds, folders, settings — the Pocket Calendar sidebar.
import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useApp } from '../lib/app-context'
import type { Dashboard, Kind } from '../lib/types'
import { KINDS } from '../lib/types'
import { Icon } from './icons'
import { KIND_ICON, KIND_LABEL } from './items'
import { type Anchor, Menu, type MenuItem, rectOf } from './ui'

export type CreateKind = 'snippet' | 'quicklink' | 'text' | 'image'

/** The "New" menu, shared by the sidebar button and the phone FAB. */
export function createItems(onCreate: (k: CreateKind) => void): MenuItem[] {
  return [
    { label: 'Snippet', icon: 'scissors', hint: 'N', onSelect: () => onCreate('snippet') },
    { label: 'Quicklink', icon: 'zap', hint: 'L', onSelect: () => onCreate('quicklink') },
    'sep',
    { label: 'Text clip', icon: 'type', hint: 'T', onSelect: () => onCreate('text') },
    { label: 'Image clip', icon: 'image', hint: 'I', onSelect: () => onCreate('image') },
  ]
}

export function Sidebar({ counts, onCreate, onNavigate }: { counts: Dashboard | null; onCreate: (k: CreateKind) => void; onNavigate: () => void }) {
  const { status, settings, folders } = useApp()
  const loc = useLocation()
  const [menu, setMenu] = useState<Anchor | null>(null)
  const title = settings?.title || status?.title || 'Pocket Clips'
  const params = new URLSearchParams(loc.search)
  const page = loc.pathname.split('/')[1] || ''
  const kindNow = page === 'clipboard' ? params.get('kind') || '' : null
  const folderNow = params.get('folder') || ''

  const nav = [
    { to: '/search', label: 'Search', icon: 'search', n: undefined as number | undefined, active: page === 'search' },
    { to: '/clipboard', label: 'Clipboard', icon: 'clipboard', n: counts?.clips, active: page === 'clipboard' && !kindNow },
    { to: '/snippets', label: 'Snippets', icon: 'scissors', n: counts?.snippets, active: page === 'snippets' && !folderNow },
    { to: '/quicklinks', label: 'Quicklinks', icon: 'zap', n: counts?.quicklinks, active: page === 'quicklinks' && !folderNow },
  ]
  const kinds: { id: 'pinned' | Kind; label: string; icon: string; n: number }[] = [
    { id: 'pinned' as const, label: 'Pinned', icon: 'pushpin', n: counts?.pinned_clips || 0 },
    ...KINDS.map(k => ({ id: k, label: KIND_LABEL[k] + 's', icon: KIND_ICON[k], n: counts?.by_kind?.[k] || 0 })),
  ].filter(k => k.n > 0)

  return (
    <aside className="sidebar" aria-label="Clips">
      <div className="sb-brand">
        <img src="/favicon.svg" alt="" className="sb-logo" />
        <span className="sb-title">{title !== 'Pocket Clips' ? title : <>Pocket <b>Clips</b></>}</span>
        {status?.version && <span className="sb-version" title={`Version ${status.version}`}>{/^\d/.test(status.version) ? 'v' + status.version : status.version}</span>}
      </div>
      <button type="button" className="btn primary create-btn" aria-haspopup="menu" aria-expanded={!!menu} onClick={e => setMenu(menu ? null : rectOf(e.currentTarget))}>
        <Icon name="plus" size={17} strokeWidth={2.2} />New<Icon name="chevron-down" size={15} className="create-caret" />
      </button>
      {menu && <Menu anchor={menu} items={createItems(onCreate)} onClose={() => setMenu(null)} width={248} />}

      <nav className="sb-nav" aria-label="Sections">
        {nav.map(n => (
          <NavLink key={n.to} to={n.to} onClick={onNavigate} className={() => `sb-nav-item ${n.active ? 'active' : ''}`} aria-current={n.active ? 'page' : undefined}>
            <Icon name={n.icon} size={16} />{n.label}
            {n.to === '/search' ? <kbd className="sb-kbd">⌘K</kbd> : n.n !== undefined && n.n > 0 && <span className="sb-count">{n.n.toLocaleString()}</span>}
          </NavLink>
        ))}
      </nav>

      {kinds.length > 0 && (
        <Group title="Clip types">
          {kinds.map(k => (
            <SbRow key={k.id} to={`/clipboard?kind=${k.id}`} icon={k.icon} label={k.label} n={k.n} active={kindNow === k.id} onNavigate={onNavigate} />
          ))}
        </Group>
      )}
      {folders.snippets.length > 0 && (
        <Group title="Snippet folders">
          {folders.snippets.map(f => <SbRow key={f} to={`/snippets?folder=${encodeURIComponent(f)}`} icon="folder" label={f} active={page === 'snippets' && folderNow === f} onNavigate={onNavigate} />)}
        </Group>
      )}
      {folders.quicklinks.length > 0 && (
        <Group title="Quicklink folders">
          {folders.quicklinks.map(f => <SbRow key={f} to={`/quicklinks?folder=${encodeURIComponent(f)}`} icon="folder" label={f} active={page === 'quicklinks' && folderNow === f} onNavigate={onNavigate} />)}
        </Group>
      )}

      <div className="sb-foot">
        <Link to="/settings" className="sb-foot-link" onClick={onNavigate}><Icon name="settings" size={15} />Settings</Link>
        <button type="button" className="sb-foot-link" onClick={() => { onNavigate(); window.dispatchEvent(new CustomEvent('pc:shortcuts')) }}><Icon name="keyboard" size={15} />Shortcuts</button>
      </div>
    </aside>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const key = 'pc-sb-' + title
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== '0')
  const toggle = () => setOpen(o => { localStorage.setItem(key, o ? '0' : '1'); return !o })
  return (
    <section className="sb-sec">
      <h4 className="sb-h"><button type="button" className="sb-h-btn" aria-expanded={open} onClick={toggle}><Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />{title}</button></h4>
      {open && <ul className="cal-list">{children}</ul>}
    </section>
  )
}

function SbRow({ to, icon, label, n, active, onNavigate }: { to: string; icon: string; label: string; n?: number; active: boolean; onNavigate: () => void }) {
  return (
    <li className={`cal-row sb-row ${active ? 'is-active' : ''}`}>
      <Link to={to} onClick={onNavigate} className="cal-check" aria-current={active ? 'page' : undefined} title={label}>
        <span className="sb-row-ico"><Icon name={icon} size={15} /></span>
        <span className="cal-name ellipsis">{label}</span>
        {n !== undefined && <span className="sb-count">{n.toLocaleString()}</span>}
      </Link>
    </li>
  )
}
