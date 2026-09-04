# Energon local-to-cloud handoff demo

Deterministic source for the README animation showing Maya move a launch-video source ZIP from a local agent on her MacBook to an agent in her cloud workspace through one explicit Energon URL.

## Regenerate

From the repository root:

```bash
vhs docs/assets/energon-machine-handoff-local.tape
vhs docs/assets/energon-machine-handoff-cloud.tape
cd docs/demo/energon-machine-handoff-demo
npm run check
npm run render -- --quality high --output renders/energon-machine-handoff-demo.mp4
ffmpeg -i renders/energon-machine-handoff-demo.mp4 \
  -vf "fps=12,scale=960:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" \
  -frames:v 1 -update 1 /tmp/energon-machine-handoff-palette.png
ffmpeg -i renders/energon-machine-handoff-demo.mp4 \
  -i /tmp/energon-machine-handoff-palette.png \
  -lavfi "fps=12,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
  ../../assets/energon-machine-handoff-demo.gif
trash /tmp/energon-machine-handoff-palette.png
```

All files, agents, paths, URLs, and output are fixtures. No Claude, Codex, Energon, or cloud service is called.

## Story contract

- Both environments belong to Maya; this is a cross-machine handoff, not collaboration.
- The full Energon URL is visibly copied and visibly fetched.
- The transition is explicit and user-directed; no synchronization is implied.
- A multi-file media folder arrives as one ZIP and becomes a finished cloud render.
