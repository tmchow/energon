<!--
Read CONTRIBUTING.md. Keep these headings. Replace the comments with answers.
Do not paste tokens, Access JWTs, or other people's files.
Do not include fork identity: wrangler.toml ids/origins, plugins/, marketplace catalogs, .dev.vars.

PR title: imperative sentence. No feat:/fix:/chore: prefix.
-->

## What

<!-- One or two sentences. Link the issue (`#123`) if one exists. -->

## Why

<!-- The operator- or agent-visible problem. One sentence is enough when What already covers it. -->

## Verify

<!-- Commands you ran (`npm run test:unit -- test/unit/…`, `npx vitest run test/api.spec.ts`). For hub / `/v1` / gate / token / public URL changes, also the verify-energon feature you drove. Green CI is not enough for those. -->

## Risk

Check every row this PR touches. Leave the rest unchecked.

- [ ] D1 schema / `migrations/`
- [ ] `/v1` route, body, status, or `ApiError` code
- [ ] Token, Access, share-password, or Connect
- [ ] Public content URL or cache
- [ ] Skill templates (`templates/`)
- [ ] Hub UI (follow DESIGN.md)
