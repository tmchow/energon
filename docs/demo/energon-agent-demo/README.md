# Energon agent demo

Source for the animated workflow at the top of the project README. The terminal
is recorded with VHS and placed inside a three-scene HyperFrames composition.

From the repository root, regenerate the deterministic terminal source:

```bash
vhs docs/assets/energon-agent-demo.tape
```

Then check and render the composition:

```bash
cd docs/demo/energon-agent-demo
npm run check
npm run render -- --quality high --output renders/energon-agent-demo.mp4
```

Export the README-safe GIF from the rendered master:

```bash
ffmpeg -y -i renders/energon-agent-demo.mp4 \
  -filter_complex "fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  ../../assets/energon-agent-demo.gif
```

The composition is 20 seconds at 1920×1080. The exported GIF is 960×540 at
12 fps so its text remains readable without approaching GitHub's 10 MB image
limit.
