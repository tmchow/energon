#!/usr/bin/env bash
set -euo pipefail

mode="${1:-publish}"
clear

if [[ "$mode" == "publish" ]]; then
  printf 'Claude Code\n\n'
  read -r -p '› ' _request
  sleep 0.5; printf '\n\n• Reading plans/workspace-invites.md\n'
  sleep 0.7; printf '• Published the plan with Energon\n'
  sleep 0.5; printf '  https://content.energon.your.co/maya/f/k7p2m9/workspace-invites.md\n\n'
  sleep 0.4; printf '  Team-editable: yes\n'
  sleep 0.35; printf '  Share password: bumblebee\n'
elif [[ "$mode" == "revise" ]]; then
  printf 'Codex\n\n'
  read -r -p '› ' _request
  sleep 0.5; printf '\n\n• Opened revision 1 from Energon\n'
  sleep 0.65; printf '• Updated Rollout and Rollback\n'
  sleep 0.55; printf '• Saved revision 2 to the same link\n'
  sleep 0.45; printf "• Posted Noah's update to Maya in Slack\n"
else
  printf 'unknown mode: %s\n' "$mode" >&2
  exit 2
fi

sleep 1
