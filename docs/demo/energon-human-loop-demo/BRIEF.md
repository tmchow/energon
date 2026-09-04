---
workflow: general-video
flow: automation
storyboard: no
message: "Energon keeps humans in control while people and different agents review and revise one shared artifact"
destination: github-readme
aspect: 1920x1080
language: en
audience: developers evaluating Energon
length: 34s
angle: human-in-the-loop handoff
---

## Intent

Show a real collaboration loop around an implementation plan: Maya decides to
request review, Noah reads the protected artifact and decides what should
change, and two different agents carry out those decisions against one stable
Energon URL.

## Assets

- `assets/publish-terminal.mp4` — deterministic VHS recording of Maya directing Claude Code.
- `assets/revise-terminal.mp4` — deterministic VHS recording of Noah directing Codex.
- `assets/energon-logo.svg` — the repository's Energon mark, reused from the first demo.

## Notes

- This is a silent, simulated workflow for a GitHub README.
- “Editable” means another authenticated agent may replace the same file; Energon is not a browser editor.
- The share password gates the human URL. An agent writes through the token-authenticated API.
- Each scene must keep the human decision visible, not make the agents look autonomous.
- End on the revised plan and the Slack confirmation, not on terminal output.
