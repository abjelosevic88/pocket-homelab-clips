import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, V1 } from './api'
import type { Settings, User } from './types'

interface AuthStatus { needs_setup: boolean; auth_mode: string; authenticated: boolean; user: User | null; version: string; title: string }
interface AppState {
  status: AuthStatus | null
  user: User | null
  settings: Settings | null
  users: User[]
  folders: { snippets: string[]; quicklinks: string[] }
  theme: 'light' | 'dark'
  toggleTheme: () => void
  refresh: () => Promise<void>
  reloadMeta: () => Promise<void>
  setUser: (u: User | null) => void
  setSettings: (s: Settings) => void
}
const Ctx = createContext<AppState>(null!)
export function useApp() { return useContext(Ctx) }

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [folders, setFolders] = useState<{ snippets: string[]; quicklinks: string[] }>({ snippets: [], quicklinks: [] })
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('pc-theme') as 'light' | 'dark') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('pc-theme', theme) }, [theme])
  useEffect(() => { if (settings?.title) document.title = settings.title }, [settings?.title])
  const reloadMeta = useCallback(async () => {
    const [u, f] = await Promise.all([api.get<User[]>(`${V1}/users`), api.get<{ snippets: string[]; quicklinks: string[] }>(`${V1}/folders`)])
    setUsers(u); setFolders(f)
  }, [])
  const refresh = useCallback(async () => {
    const st = await api.get<AuthStatus>(`${V1}/auth/status`)
    setStatus(st)
    setUser(st.user)
    if (st.authenticated) {
      setSettings(await api.get<Settings>(`${V1}/settings`))
      await reloadMeta()
    }
  }, [reloadMeta])
  useEffect(() => { refresh().catch(() => setStatus({ needs_setup: false, auth_mode: 'local', authenticated: false, user: null, version: '', title: 'Pocket Clips' })) }, [refresh])
  useEffect(() => {
    const h = () => { setUser(null); setStatus(s => s ? { ...s, authenticated: false, user: null } : s) }
    window.addEventListener('pc:unauthorized', h)
    return () => window.removeEventListener('pc:unauthorized', h)
  }, [])
  return <Ctx.Provider value={{ status, user, settings, users, folders, theme, toggleTheme: () => setTheme(t => t === 'dark' ? 'light' : 'dark'), refresh, reloadMeta, setUser, setSettings }}>{children}</Ctx.Provider>
}
