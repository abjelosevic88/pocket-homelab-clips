#!/usr/bin/env bash
# Watches the macOS pasteboard and posts every new text or image to Pocket Clips.
# Polls once a second (the pasteboard has no change notification from shell).
#
#   POCKET_CLIPS_URL=https://clips.example.com POCKET_CLIPS_TOKEN=pc_… ./macos-clipboard-watch.sh
#
# Run it at login with the LaunchAgent in docs/clients.md. Needs only pbpaste,
# osascript (frontmost app name) and curl, all part of macOS. Images need
# pngpaste (brew install pngpaste); without it only text is captured.
set -u
: "${POCKET_CLIPS_URL:?set POCKET_CLIPS_URL}"
: "${POCKET_CLIPS_TOKEN:?set POCKET_CLIPS_TOKEN}"
interval="${POCKET_CLIPS_INTERVAL:-1}"
device="${POCKET_CLIPS_DEVICE:-$(scutil --get ComputerName 2>/dev/null || hostname -s)}"
maxbytes="${POCKET_CLIPS_MAX_BYTES:-2000000}"
last=""
# Apps whose copies should never be recorded (password managers etc.), comma-separated.
ignore="${POCKET_CLIPS_IGNORE_APPS:-1Password,Bitwarden,KeePassXC,Keychain Access}"

frontmost() { osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null; }
ignored() { case ",$ignore," in *",$1,"*) return 0 ;; esac; return 1; }
post() { # $1 = content-type, stdin = body, $2 = app
  curl -fsS -m 10 -X POST "$POCKET_CLIPS_URL/api/v1/clips?source_app=$(printf '%s' "$2" | sed 's/ /%20/g')&source_device=$(printf '%s' "$device" | sed 's/ /%20/g')" \
    -H "Authorization: Bearer $POCKET_CLIPS_TOKEN" -H "Content-Type: $1" --data-binary @- -o /dev/null
}

while true; do
  # Text (or a file path list) on the pasteboard?
  text=$(pbpaste 2>/dev/null || true)
  if [ -n "$text" ]; then
    sum=$(printf '%s' "$text" | shasum | cut -c1-40)
    if [ "$sum" != "$last" ]; then
      last="$sum"
      app=$(frontmost)
      if ! ignored "$app" && [ "${#text}" -le "$maxbytes" ]; then
        printf '%s' "$text" | post "text/plain; charset=utf-8" "$app" || true
      fi
    fi
  elif command -v pngpaste >/dev/null 2>&1; then
    # No text: maybe an image. pngpaste writes PNG for any image type.
    tmp=$(mktemp -t pocketclip).png
    if pngpaste "$tmp" 2>/dev/null && [ -s "$tmp" ]; then
      sum=$(shasum "$tmp" | cut -c1-40)
      if [ "$sum" != "$last" ]; then
        last="$sum"
        app=$(frontmost)
        ignored "$app" || curl -fsS -m 30 -X POST "$POCKET_CLIPS_URL/api/v1/clips" -H "Authorization: Bearer $POCKET_CLIPS_TOKEN" \
          -F "file=@$tmp;filename=clipboard.png" -F "source_app=$app" -F "source_device=$device" -o /dev/null || true
      fi
    fi
    rm -f "$tmp"
  fi
  sleep "$interval"
done
