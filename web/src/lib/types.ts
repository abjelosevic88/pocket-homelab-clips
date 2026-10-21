export interface User { id: number; email: string; name: string; role: 'admin' | 'member'; created_at: string }
export interface APIToken { id: number; name: string; prefix: string; last_used_at: string | null; created_at: string }
export type Kind = 'text' | 'link' | 'color' | 'image' | 'file'
export const KINDS: Kind[] = ['text', 'link', 'color', 'image', 'file']
export interface Clip {
  id: number
  user_id: number
  kind: Kind
  content: string
  title: string
  source_app: string
  source_device: string
  bytes: number
  chars: number
  words: number
  lines: number
  width: number
  height: number
  pinned: boolean
  copy_count: number
  first_copied_at: string
  last_copied_at: string
  snippet?: string
}
export interface Argument { name: string; default: string }
export interface Snippet {
  id: number
  user_id: number
  owner_name: string
  name: string
  keyword: string
  content: string
  folder: string
  shared: boolean
  pinned: boolean
  use_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
  arguments: Argument[]
  snippet?: string
}
export interface Quicklink {
  id: number
  user_id: number
  owner_name: string
  name: string
  keyword: string
  link: string
  icon: string
  open_with: string
  folder: string
  shared: boolean
  pinned: boolean
  use_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
  arguments: Argument[]
}
export interface Settings {
  title: string
  clip_retention_days: number
  max_clips: number
  fetch_link_titles: boolean
  link_titles_enabled: boolean
  max_clip_bytes: number
  max_image_bytes: number
}
export interface SearchResult {
  q: string
  clips: Clip[]
  clips_total: number
  snippets: Snippet[]
  snippets_total: number
  quicklinks: Quicklink[]
  quicklinks_total: number
}
export interface ExpandResult { text: string; cursor: number; missing: string[] | null }
export interface Dashboard {
  clips: number
  clips_today: number
  pinned_clips: number
  by_kind: Record<string, number>
  last_clip_at: string
  last_clip_text: string
  last_clip_ago: string
  snippets: number
  quicklinks: number
}
