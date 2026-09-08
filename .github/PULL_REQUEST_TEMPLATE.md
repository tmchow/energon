<!--
Read CONTRIBUTING.md. Required headings: What, Why, Verify, Risk, Authorship.
Keep those. Add extra ## headings when they help a reviewer.
Do not replace the body with a commit dump. Do not paste tokens, Access JWTs,
or other people's files. Do not include fork identity: wrangler.toml ids/origins,
plugins/, marketplace catalogs, .dev.vars.

PR title: imperative sentence. No feat:/fix:/chore: prefix.
Fill Authorship. Name the model, not the product. Do not claim a human reviewed the diff if they did not.
-->

## What

<!-- One or two sentences. Link the issue (`#123`) if one exists. -->

## Why

<!-- The operator- or agent-visible problem. One sentence is enough when What already covers it. -->

## Verify

- **Tests:** <!-- Commands from the Tests table in AGENTS.md -->
- **verify-energon:** <!-- Feature file you drove (`features/….md`). Read `.agents/skills/verify-energon/SKILL.md` first. `n/a` plus why only when there is no hub / `/v1` / gate / token / public URL path. Green CI is not enough. -->

## Risk

Check every row this PR touches. Leave the rest unchecked.

- [ ] D1 schema / `migrations/`
- [ ] `/v1` route, body, status, or `ApiError` code
- [ ] Token, Access, share-password, or Connect
- [ ] Public content URL or cache
- [ ] Skill templates (`templates/`)
- [ ] Hub UI (follow DESIGN.md)

## Authorship

<!-- Name the model, not the product. "None" is valid. Do not claim a human reviewed the diff if they did not. -->

- **Model:** <!-- Cursor Grok 4.6, Claude Opus 4.6, none -->
- **Human review:** <!-- none (fully agent-created) / author reviewed the diff / another person reviewed -->

<!--
Optional — insert extra ## headings after Why (or before Authorship) only when
they help. Do not copy empty ones.

## Root cause
Bug: what was wrong and why this patch is the fix.

## Approach
Non-obvious design, or alternatives considered.

## Screenshots
Hub UI or gate. Do not commit media.

## Follow-ups
Work this PR deliberately does not do.
-->
