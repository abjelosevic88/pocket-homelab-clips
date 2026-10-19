# API

Base path `/api/v1`. JSON in, JSON out. Authenticate with the session cookie (browser) or a personal token:

```
Authorization: Bearer pc_xxxxxxxx…
```

Create tokens under **Settings → API tokens**. A token acts as the user who created it. Timestamps are RFC 3339 UTC.

## Search

| Method | Path | Notes |
|---|---|---|
| `GET` | `/search?q=…&limit=20&types=clips,snippets,quicklinks&kind=` | One query over everything, each group ranked on its own: `{"clips": […], "clips_total", "snippets": […], "snippets_total", "quicklinks": […], "quicklinks_total"}`. Empty `q` returns the recent clips and the library (pinned first). |

Search is SQLite FTS5: every word is matched as a prefix (`inv num` finds *Invoice number*), ranked by BM25 with pinned items first; when nothing tokenises (a lone `#`, a substring like `ample`) it falls back to `LIKE`. Matching passages come back as `snippet` with `<mark>` tags.

## Clips

| Method | Path | Notes |
|---|---|---|
| `GET` | `/clips` | `{"clips": […], "total"}`. Filters: `q=`, `kind=text\|link\|color\|image\|file`, `pinned=1`, `limit=` (≤500), `offset=`. Pinned first, then newest. |
| `POST` | `/clips` | Add a clip. Three body styles, see below. Returns `201` for a new clip, `200` when the same content already existed (it is moved to the top and `copy_count` incremented). |
| `DELETE` | `/clips` | Clear the history: `?kind=` for one type, `?pinned=1` to include pinned clips. `{"deleted": n}` |
| `GET` | `/clips/{id}` | One clip. |
| `GET` | `/clips/{id}/raw` | The content as `text/plain` (the image bytes for image clips): `curl … \| pbcopy`. |
| `GET` | `/clips/{id}/image` | The image file. |
| `PUT` | `/clips/{id}` | `{"title", "pinned"}` — content never changes. |
| `POST` | `/clips/{id}/touch` | "Copied again": moves it to the top. |
| `DELETE` | `/clips/{id}` | Remove it (and its image file). |

### Adding a clip

```bash
# JSON
curl -X POST https://clips.example.com/api/v1/clips -H "Authorization: Bearer pc_…" -H "Content-Type: application/json" \
  -d '{"content":"https://example.com","source_app":"Safari","source_device":"MacBook"}'

# plain text body (what the watcher scripts use); kind / source_app / source_device as query params
pbpaste | curl -X POST "https://clips.example.com/api/v1/clips?source_app=Terminal" \
  -H "Authorization: Bearer pc_…" -H "Content-Type: text/plain" --data-binary @-

# an image (png, jpeg, gif, webp, svg)
curl -X POST https://clips.example.com/api/v1/clips -H "Authorization: Bearer pc_…" -F file=@shot.png -F source_app=Screenshot
```

`kind` is detected when omitted: a single URL → `link`, a CSS colour (`#4f46e5`, `rgb(…)`, `hsl(…)`) → `color`, else `text`. Pass `"kind":"file"` for a path. The response carries `bytes`, `chars`, `words`, `lines` and, for images, `width` × `height`. Link clips get their page `<title>` filled in a moment later (unless disabled).

## Snippets

| Method | Path | Notes |
|---|---|---|
| `GET` | `/snippets` | `{"snippets": […], "total"}`. Your own plus shared ones. Filters: `q=`, `folder=`, `keyword=`, `mine=1`, `limit=`, `offset=`. |
| `POST` | `/snippets` | `{"name", "keyword", "content", "folder", "shared", "pinned"}`. `text` is accepted as an alias of `content`. Name defaults to the first words. |
| `GET` · `PUT` · `DELETE` | `/snippets/{id}` | Read / partial update (only the keys you send change) / delete. Only the owner may change a snippet (admins included: someone else's shared snippet is read-only). Another user's private snippet answers 404. |
| `POST` | `/snippets/{id}/expand` | `{"args": {"name": "Ana"}, "clipboard": "…", "selection": "…"}` → `{"text", "cursor", "missing"}`. `cursor` is the rune offset of `{cursor}` (−1 if none); `missing` lists arguments without value or default. Counts a use unless `?dry=1`. |
| `GET` | `/snippets/expand?keyword=sig&arg.name=Ana` | Same, by keyword (or `name=`, `id=`), returned as `text/plain` (`&json=1` for JSON). Made for `curl … \| pbcopy`. |
| `POST` | `/snippets/expand` | `{"keyword"\|"name"\|"id", "args", "clipboard"}` → JSON. |

Every snippet object includes `arguments`: the `{argument name="…" default="…"}` placeholders found in it, so a client can ask before expanding.

### Placeholders

| Placeholder | Expands to |
|---|---|
| `{clipboard}`, `{selection}` | What the client sent as `clipboard` / `selection`. |
| `{cursor}` | Nothing; its position is returned as `cursor`. |
| `{date}`, `{time}`, `{datetime}`, `{day}` | Now, as `yyyy-MM-dd`, `HH:mm`, `yyyy-MM-dd HH:mm`, `EEEE`. Options: `format="d MMMM yyyy"` (Unicode letters: `yyyy MM MMM MMMM dd d EEE EEEE HH hh mm ss a`), `offset="+1d"` (`y M w d h m s`, e.g. `-2w`, `+3 days`). |
| `{argument name="x" default="y"}` | The argument `x`, or its default. |
| `{snippet name="Other"}` | That snippet, expanded (max depth 5). |
| `{uuid}` | A random UUID v4. |

Unknown placeholders are left as typed.

## Quicklinks

| Method | Path | Notes |
|---|---|---|
| `GET` | `/quicklinks` | `{"quicklinks": […], "total"}`. Same filters as snippets. |
| `POST` | `/quicklinks` | `{"name", "keyword", "link", "icon", "open_with", "folder", "shared", "pinned"}`. `openWith` is accepted too. A link without a scheme gets `https://`. |
| `GET` · `PUT` · `DELETE` | `/quicklinks/{id}` | Read / partial update / delete (owner only; another user's private quicklink answers 404). |
| `POST` | `/quicklinks/{id}/open` | `{"args": {"query": "…"}, "clipboard"}` → `{"url", "open_with"}` with every placeholder filled and percent-encoded, or `{"url": "", "missing": [...], "arguments": [...]}` when input is needed. Counts a use. |
| `GET` | `/go/{keyword or id}?q=…` | Outside `/api`: redirects (302) to the resolved link. `q` fills `{Query}` and every argument that has no own parameter; `?name=value` fills a specific argument. Works with the session cookie, so a browser can use `https://clips.example.com/go/g?q=%s` as a custom search engine. |

`{Query}` (the classic quicklink placeholder) and `{argument name="…"}` both work in links; `{clipboard}` too.

## Export / import

| Method | Path | Notes |
|---|---|---|
| `GET` | `/export` | `{"app", "version", "exported_at", "snippets": [{name,text,keyword,folder,…}], "quicklinks": [{name,link,keyword,icon,openWith,…}]}`. `?clips=1` adds your clips. `?what=snippets&bare=1` / `?what=quicklinks&bare=1` returns just that array. |
| `POST` | `/import` | Body = an export, **or** a bare array (snippets `[{name,text,keyword}]` or quicklinks `[{name,link,openWith}]`, told apart by their fields). Items you already have are skipped; a keyword already in use is dropped from the imported item. → `{"snippets", "quicklinks", "clips", "skipped"}` |

## Misc

| Method | Path | Notes |
|---|---|---|
| `GET` | `/dashboard` | `{"clips", "clips_today", "pinned_clips", "by_kind": {…}, "last_clip_at", "last_clip_ago", "last_clip_text", "snippets", "quicklinks"}` — made for a Homepage / Glance widget. |
| `GET` | `/folders` | `{"snippets": [...], "quicklinks": [...]}` folder names in use. |
| `GET` | `/auth/status` · `/auth/me` · `PUT /auth/me` | Session info and profile. |
| `GET` · `POST` · `PUT` · `DELETE` | `/users`, `/users/{id}` | Admin user management. |
| `GET` · `PUT` | `/settings` | Box-wide settings (`PUT` admin only); `GET /settings/system` for runtime info and your own row counts (paths, sizes and box totals for admins). |
| `GET` · `POST` · `DELETE` | `/tokens`, `/tokens/{id}` | Your API tokens. |
| `GET` | `/backup` | A consistent SQLite copy of the whole box (admin only). |
| `GET` | `/healthz` · `/readyz` · `/metrics` | Liveness, readiness, Prometheus (no auth). |

### Homepage widget

```yaml
- Pocket Clips:
    href: https://clips.example.com/
    icon: mdi-clipboard-text-multiple
    widget:
      type: customapi
      url: http://pocket-clips:8080/api/v1/dashboard
      headers:
        Authorization: Bearer {{HOMEPAGE_VAR_POCKET_CLIPS_TOKEN}}
      mappings:
        - { field: clips, label: Clips, format: number }
        - { field: clips_today, label: Today, format: number }
        - { field: snippets, label: Snippets, format: number }
        - { field: quicklinks, label: Links, format: number }
```
