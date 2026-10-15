# Clients: getting your clipboard in

Pocket Clips is the server. Something on each device sends what you copy; the web UI (installable as a PWA) is where you search it back. Every client needs a token from **Settings → API tokens** — make one per device so you can revoke a lost laptop on its own.

All scripts live in [`deploy/clients`](../deploy/clients).

## macOS

[`macos-clipboard-watch.sh`](../deploy/clients/macos-clipboard-watch.sh) polls the pasteboard once a second with `pbpaste`, records the frontmost app as the source, skips password managers (`POCKET_CLIPS_IGNORE_APPS`), and posts images too when [pngpaste](https://github.com/jcsalterego/pngpaste) is installed (`brew install pngpaste`).

```bash
POCKET_CLIPS_URL=https://clips.example.com POCKET_CLIPS_TOKEN=pc_… ./macos-clipboard-watch.sh
```

Run it at login with a LaunchAgent — save as `~/Library/LaunchAgents/org.pocketclips.watch.plist` and `launchctl load` it:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>org.pocketclips.watch</string>
  <key>ProgramArguments</key><array><string>/usr/local/bin/macos-clipboard-watch.sh</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>POCKET_CLIPS_URL</key><string>https://clips.example.com</string>
    <key>POCKET_CLIPS_TOKEN</key><string>pc_…</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>/tmp/pocket-clips-watch.log</string>
</dict></plist>
```

**Raycast users:** [`raycast-pocket-clips.sh`](../deploy/clients/raycast-pocket-clips.sh) is a Script Command that sends the current clipboard on demand — handy if you prefer choosing what gets saved over recording everything. Your Raycast snippets and quicklinks move over with *Export* in Raycast and *Import JSON* here, and back the other way.

## Linux

[`linux-clipboard-watch.sh`](../deploy/clients/linux-clipboard-watch.sh) uses `wl-paste --watch` on Wayland (package `wl-clipboard`) or `clipnotify` + `xclip` on X11, and hands every change to [`post-clip.sh`](../deploy/clients/post-clip.sh).

```ini
# ~/.config/systemd/user/pocket-clips-watch.service
[Unit]
Description=Pocket Clips clipboard watcher
After=graphical-session.target
[Service]
Environment=POCKET_CLIPS_URL=https://clips.example.com
Environment=POCKET_CLIPS_TOKEN=pc_…
ExecStart=%h/.local/bin/linux-clipboard-watch.sh
Restart=always
[Install]
WantedBy=graphical-session.target
```

## iOS / iPadOS

A Shortcut with two actions: **Get Clipboard** → **Get Contents of URL** (`POST https://clips.example.com/api/v1/clips`, header `Authorization: Bearer pc_…`, request body JSON: `content` = Clipboard, `source_device` = `iPhone`). Put it in the Share Sheet, on the Action button or in a Back Tap. Over Tailscale it works from anywhere.

The web UI on the phone is the search side: add it to the Home Screen; tap a clip, *Copy*.

## Windows

PowerShell in a loop does the job:

```powershell
$last = ""
while ($true) {
  $t = Get-Clipboard -Raw
  if ($t -and $t -ne $last) {
    $last = $t
    Invoke-RestMethod -Method Post -Uri "https://clips.example.com/api/v1/clips?source_device=PC" `
      -Headers @{ Authorization = "Bearer pc_…" } -ContentType "text/plain; charset=utf-8" -Body $t | Out-Null
  }
  Start-Sleep -Seconds 1
}
```

## Getting things back out

- **Web UI:** `⌘K` focuses the search box from anywhere; `↑↓` move, `↵` copies (or opens a quicklink), `⌘↵` the secondary action, `⌘P` pins, `⌘⌫` deletes. The Clipboard page also accepts a plain **⌘V** anywhere to add what is on your clipboard.
- **Shell:** `curl -H "Authorization: Bearer pc_…" "https://clips.example.com/api/v1/snippets/expand?keyword=sig" | pbcopy`
- **Browser search engines:** `https://clips.example.com/go/<keyword>?q=%s` turns any quicklink with `{Query}` into an address-bar keyword.
- **Homepage / Glance:** `GET /api/v1/dashboard`, see [api.md](api.md).
