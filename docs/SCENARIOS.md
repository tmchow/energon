# Energon workflow scenarios

Energon is easiest to understand by watching work move between agents, people, and machines. These simulations show the natural-language request, the visible Energon link, and what the recipient can do with it. They use fixture data and call no external services.

[Back to the README](../README.md)

| Scenario | What it demonstrates |
| --- | --- |
| [Publish a prototype](#publish-a-prototype-and-share-it-in-slack) | An agent publishes a complete site and puts the working link where the team already communicates. |
| [Review an implementation plan](#review-an-implementation-plan-with-a-teammate) | Humans make the decisions while different agents publish and revise one shared artifact. |
| [Move a working set between machines](#move-a-working-set-between-machines) | One person hands a multi-file source package from a local agent to a cloud agent through an explicit URL. |

## Publish a prototype and share it in Slack

A person asks their agent to publish a prototype and post the link to `#design`. The agent packages the site, publishes it through Energon, and shares the returned URL. A teammate can click straight through to the working prototype.

<div align="center">
  <img src="./assets/energon-agent-demo.gif" width="900" alt="Animated simulated workflow: Codex publishes an onboarding prototype with Energon, shares it in Slack, and opens the resulting site">
</div>

**Main takeaway:** the human asks for an outcome. The agent handles the publishing protocol and returns a normal link.

## Review an implementation plan with a teammate

Maya asks Claude Code to share an implementation plan as rendered Markdown, make it team-editable, and protect it with a password. Noah reviews the plan, directs Codex to improve the rollout, and tells Maya what changed. Energon keeps the same URL throughout.

<div align="center">
  <img src="./assets/energon-human-loop-demo.gif" width="900" alt="Animated simulated workflow: Maya publishes a password-protected Markdown implementation plan, Noah reviews its rendered headings and rollout diagram, a second agent updates the same link, and Noah sends Maya the result in Slack">
</div>

**Main takeaway:** Energon supports the handoff without taking it over. People decide what to share, review, and change; agents act on those decisions.

“Team-editable” means another authenticated agent may replace the same file. The browser renders Markdown rather than acting as a collaborative editor.

## Move a working set between machines

Maya has launch-video recordings, product screenshots, a logo, and a creative brief on her MacBook. Claude Code packages the folder and returns an Energon ZIP URL. Maya gives that exact link to Codex in her remote workspace, where it fetches the package and renders the finished cut.

<div align="center">
  <img src="./assets/energon-machine-handoff-demo.gif" width="900" alt="Animated simulated workflow: Maya packages launch-video source assets with Claude Code on her local MacBook, copies the resulting Energon ZIP URL into her own remote workspace, and Codex Cloud fetches it to render a finished launch video">
</div>

**Main takeaway:** both workspaces belong to Maya. The ZIP crosses a real machine boundary through a visible Energon URL; the workspaces are not presented as synchronized.

## About the simulations

The terminal sessions are deterministic VHS recordings composed with HyperFrames. The people, agents, files, passwords, Slack messages, URLs, and output are fixtures. No Claude, Codex, Slack, Energon, or cloud service is called while generating the demos.
