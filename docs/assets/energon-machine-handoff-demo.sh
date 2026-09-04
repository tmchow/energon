#!/usr/bin/env bash
set -euo pipefail

mode="${1:-local}"
clear

if [[ "$mode" == "local" ]]; then
  printf 'Claude Code  ·  maya@macbook  ·  LOCAL\n\n'
  read -r -p '› ' _request
  sleep 0.45; printf '\n\n• Scanned ./spring-launch · 5 source assets\n'
  sleep 0.65; printf '• Created spring-launch-sources.zip · 84.6 MB\n'
  sleep 0.7; printf '• Uploaded source package to Energon\n'
  sleep 0.4; printf '  https://content.energon.your.co/maya/f/r8m4q2/spring-launch-sources.zip\n\n'
  sleep 0.35; printf '  Ready for cloud handoff\n'
elif [[ "$mode" == "cloud" ]]; then
  printf 'Codex Cloud  ·  maya/spring-launch  ·  REMOTE\n\n'
  read -r -p '› ' _request
  sleep 0.45; printf '\n\n• Fetching source package from Energon\n'
  sleep 0.35; printf '  https://content.energon.your.co/maya/f/r8m4q2/spring-launch-sources.zip\n'
  sleep 0.65; printf '• Downloaded 84.6 MB · checksum matched\n'
  sleep 0.55; printf '• Unpacked 5 assets into /workspace/spring-launch\n'
  sleep 0.65; printf '• Rendered spring-launch-cut.mp4 · 00:30\n'
else
  printf 'unknown mode: %s\n' "$mode" >&2
  exit 2
fi

sleep 1
