# Roadmap

Things that are deliberately not in v0.1, roughly in the order they might come.

- **Native clients.** A menu-bar app for macOS and a Raycast extension that read the history from here (search, paste, pin) instead of only pushing into it. The watcher scripts in `deploy/clients` are the stopgap.
- **Push from the server.** Server-sent events on `/api/v1/events` so an open tab or client updates the moment another device copies something.
- **Clip types.** OCR text for image clips (so screenshots are searchable), file clips with the file itself, rich text / HTML alongside the plain text.
- **Snippet extras.** Per-snippet default arguments, `{clipboard offset="1"}` for older clipboard entries, Raycast's `{snippet}` nesting already works.
- **Quicklink icons from the server.** Favicons are fetched by the browser from DuckDuckGo today; a cached server-side fetch would also work offline.
- **Sync groups.** Per-device views ("only what my laptop copied") and a device list under Settings.
- **Encryption at rest.** Optional passphrase that encrypts clip content in the database.

Not planned: a full Raycast replacement (launching apps, window management), browser extensions, end-to-end sync between clients without the server.
