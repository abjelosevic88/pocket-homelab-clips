#!/usr/bin/env sh
# Send stdin (or $1) to Pocket Clips as a new clip. Needs:
#   POCKET_CLIPS_URL   e.g. https://clips.example.com
#   POCKET_CLIPS_TOKEN a token from Settings → API tokens (pc_…)
# Optional: POCKET_CLIPS_APP (source app name), POCKET_CLIPS_DEVICE (device name).
#
#   echo "hello" | ./post-clip.sh
#   wl-paste --watch ./post-clip.sh            # Wayland: every clipboard change
set -eu
: "${POCKET_CLIPS_URL:?set POCKET_CLIPS_URL}"
: "${POCKET_CLIPS_TOKEN:?set POCKET_CLIPS_TOKEN}"
dev="${POCKET_CLIPS_DEVICE:-$(hostname -s 2>/dev/null || hostname)}"
app="${POCKET_CLIPS_APP:-}"
if [ "${1:-}" = "" ]; then body=$(cat); else body="$1"; fi
[ -n "$(printf '%s' "$body" | tr -d '[:space:]')" ] || exit 0
printf '%s' "$body" | curl -fsS -X POST "$POCKET_CLIPS_URL/api/v1/clips?source_device=$(printf '%s' "$dev" | sed 's/ /%20/g')&source_app=$(printf '%s' "$app" | sed 's/ /%20/g')" \
  -H "Authorization: Bearer $POCKET_CLIPS_TOKEN" -H "Content-Type: text/plain; charset=utf-8" --data-binary @- -o /dev/null
