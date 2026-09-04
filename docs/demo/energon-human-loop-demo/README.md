# Energon human-in-the-loop demo

Deterministic source for the README animation showing two people and two agents
reviewing one password-protected, team-editable implementation plan.

## Regenerate

From the repository root:

```bash
vhs docs/assets/energon-plan-review-publish.tape
vhs docs/assets/energon-plan-review-revise.tape
cd docs/demo/energon-human-loop-demo
npm run check
npm run render -- --quality high --output renders/energon-human-loop-demo.mp4
ffmpeg -i renders/energon-human-loop-demo.mp4 \
  -vf "fps=12,scale=960:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" \
  -frames:v 1 -update 1 /tmp/energon-human-loop-palette.png
ffmpeg -i renders/energon-human-loop-demo.mp4 \
  -i /tmp/energon-human-loop-palette.png \
  -lavfi "fps=12,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
  ../../assets/energon-human-loop-demo.gif
trash /tmp/energon-human-loop-palette.png
```

The terminal sessions, Slack messages, password, URLs, and plan content are
fixtures; no Claude, Slack, or Energon services or credentials are used.

## Story contract

- Maya decides to request review and controls the initial sharing policy.
- Noah opens and reviews the real Markdown rendering before requesting a change.
- Claude Code publishes; Codex revises. Both act on explicit human instructions.
- Energon preserves the artifact's URL while Noah's Slack message closes the loop.
