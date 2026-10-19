# Configuration

All settings are environment variables. Nothing is required.

## Server

| Variable | Default | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | Listen address. |
| `PORT` | `8080` | Listen port. |
| `BASE_URL` | – | Public URL (e.g. `https://clips.example.com`). Also the base of the OIDC callback and the redirect URI the app asks Pocket Core for. |
| `DATA_DIR` | `./data` (`/data` in the container) | Database, images and backups. |
| `DB_PATH` | `$DATA_DIR/pocket-clips.db` | Override the database file. |
| `IMAGES_DIR` | `$DATA_DIR/images` | Where image clips are stored (one file per distinct image, named by content hash). |
| `TZ` | `UTC` | Timezone for `{date}` / `{time}` in snippets and for "today" in the dashboard. The container ships `tzdata`. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. |
| `LOG_FORMAT` | `text` | `text` or `json`. |
| `TRUST_PROXY` | `true` | Honour `X-Forwarded-For` / `X-Real-IP` for logging. |
| `METRICS_ENABLED` | `true` | Serve Prometheus metrics on `/metrics` (unauthenticated — restrict at the proxy if exposed). |
| `CORE_URL` / `CORE_REGISTRATION_KEY` | – | [Pocket Core](https://git.bjelke.org/abjelosevic88/pocket-homelab-core): register on start (the key is needed once; the minted app token lives in `$DATA_DIR/core.token`), publish `clips.clip_created` / `clips.snippet_created` / `clips.quicklink_created`, and accept the tokens Core hands to paired phones. |
| `CORE_APP_URL` | `BASE_URL` | How Core reaches this app for health checks (e.g. `http://host.docker.internal:8173`). |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | – | Sign in with an OpenID Connect provider (PocketID, Authelia, Authentik, Keycloak…). Needs `BASE_URL`; the callback is `BASE_URL/api/v1/auth/oidc/callback`. On a box with Pocket Core none of these are needed — the app receives its client when it registers. |
| `OIDC_NAME` | `single sign-on` | Button label: “Sign in with …” (a Core-issued client is labelled “Pocket Core”). |
| `OIDC_AUTO_CREATE` | `true` | Give an unknown (verified) email a member account instead of refusing it. Always on for a Core-issued client. |
| `DEMO_DATA` | `false` | Seed sample clips, snippets and quicklinks into an *empty* history. |

## Clips

| Variable | Default | Description |
|---|---|---|
| `MAX_CLIP_BYTES` | `2097152` (2 MB) | Largest text clip accepted; bigger posts get `413`. |
| `MAX_IMAGE_BYTES` | `20971520` (20 MB) | Largest image clip accepted. |
| `LINK_TITLES` | `true` | Allow looking up the `<title>` of copied URLs (one GET with a 6 s timeout, in the background). `false` never makes outbound requests; Settings → General has a switch too. |
| `PURGE_INTERVAL` | `1h` | How often the retention policy runs. |

Retention itself is set in **Settings → General** (shared, admin only): *Keep clipboard history for* 1 week … forever, and *Maximum clips per user*. Pinned clips are never purged.

## Authentication & users

| Variable | Default | Description |
|---|---|---|
| `AUTH_MODE` | `local` | `local`: built-in email + password, first-run setup screen, users managed under Settings → Users. `proxy`: trust the user name from a header set by your SSO proxy; users are auto-created on first visit (first one becomes admin). `none`: no login at all, one implicit user — only for trusted networks. |
| `AUTH_PROXY_HEADER` | `Remote-User` | Header carrying the user name in `proxy` mode. |
| `AUTH_PROXY_EMAIL_HEADER` | `Remote-Email` | Header carrying the email in `proxy` mode. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | – | In `local` mode, create this admin on first start instead of showing the setup screen. Password must be 8+ characters. |
| `SESSION_TTL` | `720h` | Browser session lifetime. |
| `SECURE_COOKIES` | `false` | Mark the session cookie `Secure`. Turn on behind HTTPS. |

**Who sees what.** Clipboard history is strictly per user. Snippets and quicklinks belong to the user who made them; marking one *shared* lets every other user see and use it (read-only for them; "Duplicate to mine" makes an editable copy). Keywords are unique per user; your own keyword wins over a shared one. Roles: **admin** manages users and the shared settings and may edit anyone's shared items; **member** manages their own. API tokens (`Authorization: Bearer …` or `X-API-Key`) work in every mode and act as the user who created them.

## In-app settings

- **Settings → General:** app title, retention period, maximum clips per user, link-title lookup (admins only).
- **Settings → Clients:** copy-paste commands for feeding the history from macOS, Linux, iOS and curl.
- **Settings → API tokens:** one token per device makes revoking painless.
- **Settings → Backup & data:** database download, library export/import.

## Forgot your password?

```bash
docker exec pocket-clips pocket-clips reset-password            # first user, random password printed
docker exec pocket-clips pocket-clips reset-password -email me@example.com -password NewPass123
```
