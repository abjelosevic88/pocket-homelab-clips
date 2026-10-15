import { useCallback, useState } from 'react'
import { api, V1 } from './api'
import { copyImage, copyText } from './clipboard'
import type { Argument, Clip, ExpandResult, Quicklink, Snippet } from './types'
import { useToast } from '../components/ui'
import { ArgsModal } from '../components/items'

type Pending = { title: string; args: Argument[]; resolve: (v: Record<string, string> | null) => void }

/** The primary actions on the three item types, shared by every page. Render
 *  {prompt} somewhere so argument dialogs can appear. */
export function useActions() {
  const { toast } = useToast()
  const [pending, setPending] = useState<Pending | null>(null)

  const ask = useCallback((title: string, args: Argument[]) => new Promise<Record<string, string> | null>(resolve => setPending({ title, args, resolve })), [])

  /** Copy a clip's content and move it to the top of the history. */
  const copyClip = useCallback(async (c: Clip): Promise<Clip | null> => {
    let ok: boolean
    if (c.kind === 'image') {
      ok = await copyImage(`${V1}/clips/${c.id}/image`)
      if (!ok) { toast('Image copy is not supported here; opening it instead', 'err'); window.open(`${V1}/clips/${c.id}/image`, '_blank'); return null }
    } else ok = await copyText(c.content)
    if (!ok) { toast('Could not access the clipboard', 'err'); return null }
    toast(c.kind === 'image' ? 'Image copied' : 'Copied')
    try { return await api.post<Clip>(`${V1}/clips/${c.id}/touch`) } catch { return c }
  }, [toast])

  /** Expand a snippet (asking for arguments when needed) and copy the result. */
  const useSnippet = useCallback(async (s: Snippet): Promise<boolean> => {
    let args: Record<string, string> = {}
    if (s.arguments.length) {
      const a = await ask(s.name, s.arguments)
      if (!a) return false
      args = a
    }
    let clipboard = ''
    try { if (navigator.clipboard && window.isSecureContext && /\{\s*clipboard/i.test(s.content)) clipboard = await navigator.clipboard.readText() } catch {}
    try {
      const r = await api.post<ExpandResult>(`${V1}/snippets/${s.id}/expand`, { args, clipboard })
      if (await copyText(r.text)) { toast(`“${s.name}” copied`); return true }
      toast('Could not access the clipboard', 'err')
    } catch (e) { toast((e as Error).message, 'err') }
    return false
  }, [ask, toast])

  /** Resolve a quicklink (asking for its arguments) and open it in a new tab. */
  const openQuicklink = useCallback(async (q: Quicklink): Promise<boolean> => {
    let args: Record<string, string> = {}
    if (q.arguments.length) {
      const a = await ask(q.name, q.arguments)
      if (!a) return false
      args = a
    }
    try {
      const r = await api.post<{ url: string; missing?: string[] }>(`${V1}/quicklinks/${q.id}/open`, { args })
      if (!r.url) { toast('Missing: ' + (r.missing || []).join(', '), 'err'); return false }
      const w = window.open(r.url, '_blank', 'noopener')
      if (!w) { await copyText(r.url); toast('Pop-up blocked — link copied instead') }
      return true
    } catch (e) { toast((e as Error).message, 'err'); return false }
  }, [ask, toast])

  const prompt = pending ? <ArgsModal title={pending.title} args={pending.args} onClose={() => { pending.resolve(null); setPending(null) }} onSubmit={v => { pending.resolve(v); setPending(null) }} /> : null
  return { copyClip, useSnippet, openQuicklink, prompt, toast }
}
