// The app shell: sidebar, top bar, search palette, shortcuts — the Pocket Calendar layout.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api, V1 } from '../lib/api'
import { useApp } from '../lib/app-context'
import { useActions } from '../lib/actions'
import { announceChange, useOnChange } from '../lib/events'
import type { Dashboard, Kind } from '../lib/types'
import { Icon } from './icons'
import { type CreateKind, Sidebar, createItems } from './Sidebar'
import { CommandPalette, type PaletteCommand } from './CommandPalette'
import { ShortcutsSheet } from './ShortcutsSheet'
import { AddTextModal, KIND_LABEL } from './items'
import { Avatar, type Anchor, Menu, type MenuItem, MenuButton, modalOpen, rectOf, useIsMobile, useMediaQuery, useToast } from './ui'
import { AskButton } from './AskButton'

const SIDEBAR_KEY = 'pc-sidebar'

/** Clip counts for the sidebar badges (GET /api/v1/dashboard). */
function useCounts() {
  const loc = useLocation()
  const [counts, setCounts] = useState<Dashboard | null>(null)
  const load = useCallback(() => { api.get<Dashboard>(`${V1}/dashboard`).then(setCounts).catch(() => {}) }, [])
  useEffect(() => { load() }, [load, loc.pathname, loc.search])
  useOnChange(load)
  useEffect(() => {
    const t = setInterval(load, 60_000)
    const vis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [load])
  return counts
}

export default function Layout() {
  const navigate = useNavigate()
  const loc = useLocation()
  const { toast } = useToast()
  const mobile = useIsMobile()
  const narrow = useMediaQuery('(max-width: 1099px)')
  const drawer = mobile || narrow
  const [sidebarOpen, setSidebarOpen] = useState(() => !drawer && localStorage.getItem(SIDEBAR_KEY) !== '0')
  useEffect(() => { setSidebarOpen(!drawer && localStorage.getItem(SIDEBAR_KEY) !== '0') }, [drawer])
  const drawerOpenedAt = useRef(0)
  const toggleSidebar = () => setSidebarOpen(o => { drawerOpenedAt.current = performance.now(); const n = !o; if (!drawer) localStorage.setItem(SIDEBAR_KEY, n ? '1' : '0'); return n })
  const closeDrawer = () => { if (drawer) setSidebarOpen(false) }
  useEffect(() => { document.querySelector('.content')?.scrollTo({ top: 0 }) }, [loc.pathname])

  const counts = useCounts()
  const actions = useActions()
  const [palette, setPalette] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)
  const [addText, setAddText] = useState(false)
  const [fabMenu, setFabMenu] = useState<Anchor | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const upload = async (f: File) => {
    const fd = new FormData(); fd.append('file', f); fd.append('source_app', 'Pocket Clips')
    const r = await fetch(`${V1}/clips`, { method: 'POST', body: fd, credentials: 'same-origin' })
    if (!r.ok) { toast((await r.json().catch(() => ({}))).error || 'Upload failed', 'err'); return }
    toast('Image added'); announceChange()
  }
  const create = (k: CreateKind) => {
    closeDrawer()
    if (k === 'snippet') navigate('/snippets?new=1')
    else if (k === 'quicklink') navigate('/quicklinks?new=1')
    else if (k === 'text') setAddText(true)
    else fileInput.current?.click()
  }
  const createRef = useRef(create)
  createRef.current = create

  useEffect(() => {
    const open = () => setShortcuts(true)
    window.addEventListener('pc:shortcuts', open)
    return () => window.removeEventListener('pc:shortcuts', open)
  }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (t.closest('input, textarea, select, [contenteditable="true"]') || modalOpen() || document.querySelector('.menu, .popover, .sel-pop, .lightbox')) return
      const go = (to: string) => { e.preventDefault(); navigate(to) }
      switch (e.key) {
        case '/': e.preventDefault(); setPalette(true); break
        case '?': e.preventDefault(); setShortcuts(true); break
        case '1': go('/search'); break
        case '2': go('/clipboard'); break
        case '3': go('/snippets'); break
        case '4': go('/quicklinks'); break
        case ',': go('/settings'); break
        case 'n': e.preventDefault(); createRef.current('snippet'); break
        case 'l': e.preventDefault(); createRef.current('quicklink'); break
        case 't': e.preventDefault(); createRef.current('text'); break
        case 'i': e.preventDefault(); createRef.current('image'); break
        case '[': e.preventDefault(); toggleSidebar(); break
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const commands: PaletteCommand[] = [
    { id: 'search', label: 'Search everything', icon: 'search', hint: '1', keywords: 'find all', run: () => navigate('/search') },
    { id: 'clipboard', label: 'Clipboard history', icon: 'clipboard', hint: '2', keywords: 'clips copied', run: () => navigate('/clipboard') },
    { id: 'pinned', label: 'Pinned clips', icon: 'pushpin', keywords: 'clipboard', run: () => navigate('/clipboard?kind=pinned') },
    { id: 'snippets', label: 'Snippets', icon: 'scissors', hint: '3', keywords: 'templates text', run: () => navigate('/snippets') },
    { id: 'quicklinks', label: 'Quicklinks', icon: 'zap', hint: '4', keywords: 'links bookmarks search engine', run: () => navigate('/quicklinks') },
    { id: 'new-snippet', label: 'New snippet', icon: 'plus', hint: 'N', keywords: 'create add', run: () => create('snippet') },
    { id: 'new-quicklink', label: 'New quicklink', icon: 'plus', hint: 'L', keywords: 'create add', run: () => create('quicklink') },
    { id: 'add-text', label: 'Add a text clip', icon: 'type', hint: 'T', keywords: 'paste create', run: () => create('text') },
    { id: 'add-image', label: 'Add an image clip', icon: 'image', hint: 'I', keywords: 'upload picture screenshot', run: () => create('image') },
    { id: 'tokens', label: 'API tokens', icon: 'key', keywords: 'settings device watcher', run: () => navigate('/settings/tokens') },
    { id: 'clients', label: 'Connect a device', icon: 'smartphone', keywords: 'settings clients watcher mac linux ios', run: () => navigate('/settings/clients') },
    { id: 'settings', label: 'Settings', icon: 'settings', hint: ',', run: () => navigate('/settings') },
    { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', hint: '?', run: () => setShortcuts(true) },
  ]

  return (
    <div className={`app ${sidebarOpen ? 'with-sidebar' : 'no-sidebar'} ${mobile ? 'is-mobile' : ''} ${drawer ? 'drawer-mode' : ''}`}>
      {drawer && sidebarOpen && <div className="drawer-backdrop" onClick={e => { if (e.timeStamp - drawerOpenedAt.current > 400) setSidebarOpen(false) }} />}
      <div className={`sidebar-wrap ${sidebarOpen ? 'open' : ''}`}>
        <Sidebar counts={counts} onCreate={create} onNavigate={closeDrawer} />
      </div>
      <div className="main">
        <TopBar onMenu={toggleSidebar} onPalette={() => setPalette(true)} mobile={mobile} compact={narrow} sidebarOpen={sidebarOpen} />
        <main className="content"><div className="content-inner"><Outlet /></div></main>
      </div>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f) }} />
      {mobile && <button type="button" className="fab" aria-label="New" title="New" aria-haspopup="menu" aria-expanded={!!fabMenu} onClick={e => setFabMenu(fabMenu ? null : rectOf(e.currentTarget))}><Icon name="plus" size={24} strokeWidth={2} /></button>}
      {fabMenu && <Menu anchor={fabMenu} align="right" items={createItems(create)} onClose={() => setFabMenu(null)} width={220} />}
      {palette && <CommandPalette onClose={() => setPalette(false)} commands={commands} actions={actions} />}
      {shortcuts && <ShortcutsSheet onClose={() => setShortcuts(false)} />}
      {addText && <AddTextModal onClose={() => setAddText(false)} onAdded={() => { setAddText(false); announceChange() }} />}
      {actions.prompt}
    </div>
  )
}

const SECTION: Record<string, string> = { search: 'Search', clipboard: 'Clipboard', snippets: 'Snippets', quicklinks: 'Quicklinks' }

function TopBar({ onMenu, onPalette, mobile, compact, sidebarOpen }: { onMenu: () => void; onPalette: () => void; mobile: boolean; compact: boolean; sidebarOpen: boolean }) {
  const { user, themeMode, setThemeMode, status, setUser } = useApp()
  const navigate = useNavigate()
  const loc = useLocation()
  const page = loc.pathname.split('/')[1] || 'search'
  const section = SECTION[page] || ''
  const params = new URLSearchParams(loc.search)
  const kind = page === 'clipboard' ? params.get('kind') || '' : ''
  const sub = page === 'snippets' || page === 'quicklinks' ? params.get('folder') || '' : kind === 'pinned' ? 'Pinned' : kind && kind in KIND_LABEL ? KIND_LABEL[kind as Kind] + 's' : ''
  const signOut = async () => { await api.post(`${V1}/auth/logout`).catch(() => {}); setUser(null); navigate('/login') }
  const avatarMenu = (): MenuItem[] => [
    { heading: user?.name || user?.email || '' },
    { label: 'Profile', icon: 'user', onSelect: () => navigate('/settings/profile') },
    { label: 'Settings', icon: 'settings', onSelect: () => navigate('/settings'), hint: ',' },
    { label: 'Keyboard shortcuts', icon: 'keyboard', onSelect: () => window.dispatchEvent(new CustomEvent('pc:shortcuts')), hint: '?' },
    'sep',
    { heading: 'Appearance' },
    { label: 'System', checked: themeMode === 'system', onSelect: () => setThemeMode('system') },
    { label: 'Light', checked: themeMode === 'light', onSelect: () => setThemeMode('light') },
    { label: 'Dark', checked: themeMode === 'dark', onSelect: () => setThemeMode('dark') },
    ...(status?.auth_mode === 'local' ? ['sep' as const, { label: 'Sign out', icon: 'log-out', onSelect: signOut }] : []),
  ]
  return (
    <header className="topbar">
      <button type="button" className="btn ghost icon-only" onClick={onMenu} aria-label={sidebarOpen ? 'Hide the sidebar' : 'Show the sidebar'} title="Menu ([)"><Icon name={mobile || compact ? 'menu' : 'sidebar'} size={18} /></button>
      <h1 className="range-title">
        {sub ? <><button type="button" className="crumb" onClick={() => navigate(`/${page}`)}>{section}</button><Icon name="chevron-right" size={16} className="crumb-sep" /><span className="ellipsis">{sub}</span></> : section}
      </h1>
      <span className="spacer" />
      <button type="button" className="btn ghost icon-only" onClick={onPalette} aria-label="Search" title="Search (⌘K or /)"><Icon name="search" size={18} /></button>
      {mobile && <AskButton />}
      <MenuButton label="Account" className="avatar-btn" align="right" width={220} items={avatarMenu}>
        <Avatar name={user?.name} email={user?.email} size={30} />
      </MenuButton>
    </header>
  )
}
