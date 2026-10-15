#!/bin/bash
# Raycast Script Command: send the current clipboard to Pocket Clips with one keystroke.
# Save in your Raycast script directory, fill in the two variables, assign a hotkey.
#
# @raycast.schemaVersion 1
# @raycast.title Save clipboard to Pocket Clips
# @raycast.mode silent
# @raycast.icon 📋
# @raycast.packageName Pocket Clips

POCKET_CLIPS_URL="https://clips.example.com"
POCKET_CLIPS_TOKEN="pc_…"

app=$(osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null)
if pbpaste | grep -q .; then
  pbpaste | curl -fsS -X POST "$POCKET_CLIPS_URL/api/v1/clips?source_app=${app// /%20}&source_device=Raycast" \
    -H "Authorization: Bearer $POCKET_CLIPS_TOKEN" -H "Content-Type: text/plain; charset=utf-8" --data-binary @- -o /dev/null && echo "Saved to Pocket Clips"
else
  echo "Clipboard is empty"
fi
