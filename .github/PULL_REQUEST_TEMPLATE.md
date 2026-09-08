<!--
Read CONTRIBUTING.md. Required headings: What, Why, Verify, Risk, Authorship.
Keep those. Add extra ## headings when they help a reviewer.
Do not replace the body with a commit dump. Do not paste tokens, Access JWTs,
or other people's files. Do not include fork identity: wrangler.toml ids/origins,
plugins/, marketplace catalogs, .dev.vars.

PR title: imperative sentence. No feat:/fix:/chore: prefix.
Fill Authorship. Name the model, not the product.
-->

## What

<!-- One or two sentences. `Fixes #123` when this closes an issue. -->

## Why

<!-- The operator- or agent-visible problem. One sentence is enough when What already covers it. -->

## Verify

- **Tests:** <!-- Commands from the Tests table in AGENTS.md -->
- **verify-energon:** <!-- Feature file you drove (`features/….md`). Read `.agents/skills/verify-energon/SKILL.md` first. `n/a` plus why only when there is no hub / `/v1` / gate / token / public URL path. Green CI is not enough. -->
- **How:** <!-- Numbered steps a reviewer can follow. For bugs: reproduction + proof the fix works. -->

## Risk

Check every row this PR touches. Leave the rest unchecked.

- [ ] D1 schema / `migrations/`
- [ ] `/v1` route, body, status, or `ApiError` code
- [ ] Token, Access, share-password, or Connect
- [ ] Public content URL or cache
- [ ] Skill templates (`templates/`)
- [ ] Hub UI (follow DESIGN.md)

If you checked a row, name its companion in Verify (`openapi/v1.json`, `helpBody`/`llms.txt`, goldens, verify-energon map, `skill:render --check`).

## Authorship

<!-- Name the model, not the product. "None" when a person wrote the patch. -->

- **Model:** <!-- Cursor Grok 4.6, Claude Opus 4.6, none -->
