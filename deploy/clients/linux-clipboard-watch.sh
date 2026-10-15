#!/usr/bin/env bash
# Linux clipboard watcher for Pocket Clips: Wayland (wl-clipboard) or X11 (clipnotify + xclip).
#
#   POCKET_CLIPS_URL=https://clips.example.com POCKET_CLIPS_TOKEN=pc_… ./linux-clipboard-watch.sh
#
# Install as a user service: see docs/clients.md.
set -u
: "${POCKET_CLIPS_URL:?set POCKET_CLIPS_URL}"
: "${POCKET_CLIPS_TOKEN:?set POCKET_CLIPS_TOKEN}"
here=$(cd "$(dirname "$0")" && pwd)
export POCKET_CLIPS_DEVICE="${POCKET_CLIPS_DEVICE:-$(hostname -s)}"

if [ -n "${WAYLAND_DISPLAY:-}" ] && command -v wl-paste >/dev/null; then
  # wl-paste runs the command on every change with the content on stdin.
  exec wl-paste --no-newline --type text --watch "$here/post-clip.sh"
elif command -v clipnotify >/dev/null && command -v xclip >/dev/null; then
  last=""
  while clipnotify; do
    text=$(xclip -o -selection clipboard 2>/dev/null || true)
    [ -n "$text" ] || continue
    sum=$(printf '%s' "$text" | sha1sum | cut -c1-40)
    [ "$sum" = "$last" ] && continue
    last="$sum"
    printf '%s' "$text" | "$here/post-clip.sh" || true
  done
else
  echo "need wl-clipboard (Wayland) or clipnotify + xclip (X11)" >&2
  exit 1
fi
