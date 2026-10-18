import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api, V1 } from '../lib/api'
import { useApp } from '../lib/app-context'
import { Avatar } from './people'

const nav = [
  { to: '/search', label: 'Search', ico: '⌕' },
  { to: '/clipboard', label: 'Clipboard', ico: '▣' },
  { to: '/snippets', label: 'Snippets', ico: '✂' },
  { to: '/quicklinks', label: 'Quicklinks', ico: '↗' },
  { to: '/settings', label: 'Settings', ico: '⚙' },
]

export default function Layout() {
  const { user, settings, status, theme, toggleTheme, setUser } = useApp()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const logout = async () => { await api.post(`${V1}/auth/logout`); setUser(null); navigate('/login') }
  const title = settings?.title || 'Pocket Clips'
  // ⌘K / Ctrl+K from anywhere jumps to the search box.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); navigate('/search'); setTimeout(() => document.querySelector<HTMLInputElement>('.pal-search input')?.focus(), 0) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [navigate])
  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
        <div className="brand"><span className="logo"><img src="/favicon.svg" alt="" /></span><span className="brand-name">{title}</span></div>
        <nav>
          {nav.map(n => <NavLink key={n.to} to={n.to} className={({ isActive }) => isActive ? 'active' : ''}><span className="ico">{n.ico}</span>{n.label}{n.to === '/search' && <span className="kbd nav-kbd">⌘K</span>}</NavLink>)}
        </nav>
        <div className="foot">
          <span className="row" title={user?.email}>{user && <Avatar user={user} />}<span className="foot-id"><span>{user?.name || user?.email}</span>{status?.version && <a className="ver" href="https://github.com/abjelosevic88/pocket-homelab-clips/releases" target="_blank" rel="noreferrer" title="Version — click for release notes">v{status.version.replace(/^v/, '')}</a>}</span></span>
          <span className="row">
            <button className="btn ghost sm" onClick={toggleTheme} title="Toggle theme">{theme === 'dark' ? '☀' : '☾'}</button>
            {status?.auth_mode === 'local' && <button className="btn ghost sm" onClick={logout} title="Sign out">⎋</button>}
          </span>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn ghost icon menu-btn" onClick={() => setOpen(o => !o)} aria-label="Menu">☰</button>
          <span className="topbar-title">{title}</span>
          <span className="spacer" />
          <button className="btn ghost sm" onClick={toggleTheme} title="Toggle theme">{theme === 'dark' ? '☀' : '☾'}</button>
        </header>
        <main className="content"><Outlet /></main>
        <nav className="tabbar">
          {nav.map(n => <NavLink key={n.to} to={n.to} className={({ isActive }) => isActive ? 'active' : ''}><span className="ico">{n.ico}</span><span>{n.label}</span></NavLink>)}
        </nav>
      </div>
    </div>
  )
}

/** A clipboard with three lines. */
export function Logo() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6" y="5" width="12" height="16" rx="2" />
      <path d="M9 5.3V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.3" />
      <path d="M9.5 11h5M9.5 14.5h5M9.5 18h3" />
    </svg>
  )
}
