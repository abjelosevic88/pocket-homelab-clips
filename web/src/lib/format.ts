export const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || /Mac/.test(navigator.userAgent)
export const mod = isMac ? '⌘' : 'Ctrl'

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const d = (Date.now() - new Date(iso).getTime()) / 1000
  if (d < 45) return 'just now'
  if (d < 90) return 'a minute ago'
  if (d < 3600) return `${Math.round(d / 60)} minutes ago`
  if (d < 7200) return 'an hour ago'
  if (d < 86400) return `${Math.round(d / 3600)} hours ago`
  if (d < 172800) return 'yesterday'
  if (d < 86400 * 30) return `${Math.round(d / 86400)} days ago`
  return fmtDate(iso)
}
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
export function plural(n: number, one: string, many = one + 's'): string { return `${n.toLocaleString()} ${n === 1 ? one : many}` }
export function initials(name: string): string {
  const p = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return ((p[0]?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase()
}
const palette = ['#4f46e5', '#0d9488', '#d97706', '#db2777', '#2563eb', '#16a34a', '#7c3aed', '#ea580c']
export function colorFor(id: number): string { return palette[Math.abs(id) % palette.length] }
export function hostOf(link: string): string {
  try { return new URL(link.replace(/\{[^}]*\}/g, 'x')).hostname.replace(/^www\./, '') } catch { return '' }
}
/** Split a template into text and {placeholder} parts for highlighting. */
export function tokens(tpl: string): { text: string; ph: boolean }[] {
  const out: { text: string; ph: boolean }[] = []
  const re = /\{[^{}]*\}/g
  let last = 0
  for (const m of tpl.matchAll(re)) {
    if (m.index! > last) out.push({ text: tpl.slice(last, m.index), ph: false })
    out.push({ text: m[0], ph: true })
    last = m.index! + m[0].length
  }
  if (last < tpl.length) out.push({ text: tpl.slice(last), ph: false })
  return out
}
