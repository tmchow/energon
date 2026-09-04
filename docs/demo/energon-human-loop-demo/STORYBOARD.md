---
format: 1920x1080
duration: 34s
message: "Energon keeps humans in control while people and different agents review and revise one shared artifact"
arc: Ask → Share → Review → Revise → Confirm
audience: developers evaluating Energon
mode: autonomous
---

## Frame 1 — Publish for review

- status: animated
- src: compositions/01-publish.html
- duration: 8.5s
- transition_in: cut
- poster: 7.2s
- scene: Maya asks Claude Code to publish the existing plan as team-editable and password-protected.
- motion: ambient-glow-bloom + card-morph-anchor

The natural-language request and the agent's confirmation must both be readable.
The stable link, team write policy, and password are the proof.

## Frame 2 — Share with a teammate

- status: animated
- src: compositions/02-dm-share.html
- duration: 4.5s
- transition_in: cut
- poster: 2.8s
- scene: Maya pastes the link and password into a Slack DM to Noah.
- motion: spring-pop-entrance + cursor-click-ripple

The scene must read as a person-to-person handoff, not an automated channel post.

## Frame 3 — Human reviews the plan

- status: animated
- src: compositions/03-review.html
- duration: 7s
- transition_in: cut
- poster: 5.4s
- scene: Noah unlocks the protected link and notices that rollout jumps directly to every workspace.
- motion: cursor-click-ripple + control-target-sync + ambient-glow-bloom

Energon renders the Markdown; it does not pretend to be an editor. Noah's cursor
lands on the risky “All workspaces” node in a rendered Mermaid rollout diagram.

## Frame 4 — Human directs the change

- status: animated
- src: compositions/04-revise.html
- duration: 8s
- transition_in: cut
- poster: 6.8s
- scene: Noah asks Codex to add a 10% canary, a 2% rollback threshold, and notify Maya.
- motion: ambient-glow-bloom + card-morph-anchor

Use a different agent surface from the first half so interoperability is obvious.

## Frame 5 — Same link, shared result

- status: animated
- src: compositions/05-confirm.html
- duration: 6s
- transition_in: cut
- poster: 4.2s
- scene: Revision 2 is visible beside Noah's Slack message to Maya, posted on his behalf by his agent.
- motion: control-target-sync + spring-pop-entrance + ambient-glow-bloom

The final hold must show the revised Markdown, updated Mermaid flow, exact
rollback condition, and same-link outcome at once.
