# Contributing

This repository is the Energon source you fork and run for yourself or your organization.
[getenergon.com](https://getenergon.com) explains the project; there is no hosted public service there.

**Issues and pull requests are welcome** against [`tmchow/energon`](https://github.com/tmchow/energon).
Small, focused patches that follow this file are the ones that land. Merge is not promised:
the maintainer may request changes, squash, edit, or reimplement the idea instead of merging as-is.

On a company fork, follow that repo's humans. This file is policy for `tmchow/energon` only.

Security reports: see [SECURITY.md](./SECURITY.md). Do not file those as public issues or pull requests.

## What belongs upstream

Send PRs that help every Energon:

- Worker, hub UI, `/v1`, tests
- Skill **templates** (`templates/`), render scripts, docs that apply to every host
- Bug fixes with a reproduction or a failing test

Keep your deployed Energon's identity on the fork. Do **not** include:

- `wrangler.toml` database ids, origins, or account-specific vars
- `.dev.vars`, live tokens, Access JWTs, or other people’s files
- Generated `plugins/`, marketplace catalogs, or an `instance-skill.json` pointed at a real origin

Those files are how a fork becomes *your* Energon. Upstream stays a template.

## Before you open a PR

1. Search [issues](https://github.com/tmchow/energon/issues) and [pull requests](https://github.com/tmchow/energon/pulls?q=is%3Apr) (open and merged) before you build. Review or extend an open PR instead of duplicating it.
2. [Open an issue](https://github.com/tmchow/energon/issues/new/choose) first when the change is a new `/v1` surface, a schema migration, or a hub flow that is not an obvious bug. A short "should this exist?" issue saves a large patch that will not merge.
3. Skip the issue for typos, test-only fixes, and bugs that already have a reproduction in the PR.
4. One concern per PR. Do not mix formatting or drive-by refactors with a behavior change.
5. Fill [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md). Keep the required headings (What, Why, Verify, How to test, Risk, Authorship). Add extra `##` sections when they help a reviewer. Agents: do not delete required sections or replace the body with a commit dump. Name the model in Authorship (not "Cursor" or "an AI"). "None" is valid when a person wrote the patch.

## Commits and titles

This repo squash-merges. The **PR title** is the commit on `main`. CI
(`.github/workflows/pr-title.yml`) requires [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope)?: subject
```

- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- Scope is optional (`hub`, `v1`, `gate`, `skill`, …). Breaking change: `feat(v1)!: …`
- Subject is lowercase imperative, no trailing period
- Yes: `feat(hub): show expiry on the catalog row`
- No: `Cap public edge cache at one day` / `feat: Cap public edge cache` / `Updates`

Do not put `feat:` on every commit on the branch. Those commits are squashed away.
Commit bodies explain why when the subject cannot.

GitHub squash default should be **Pull request title** (Settings → General → Pull Requests),
not title and description. Mark **Conventional commit title** required on `main` so a PR
cannot merge without it.

## Tests

Match the table in [AGENTS.md](./AGENTS.md). CI (`.github/workflows/ci.yml`) must stay green.

For hub UI, `/v1`, gate, token, or public URL changes, green CI is not proof. Read and follow
the verify-energon skill ([`.agents/skills/verify-energon/SKILL.md`](./.agents/skills/verify-energon/SKILL.md))
and name the feature file you drove in Verify. Fill **How to test** with numbered steps a
triage agent can run without asking you (command or URL, then the expected result).
Follow [DESIGN.md](./DESIGN.md) for UI.

Do not `wrangler deploy`, stamp `d1_migrations`, or execute D1 against production. New schema
belongs in `migrations/` first, plus `src/db.ts` and `src/schema.sql` as [AGENTS.md](./AGENTS.md) describes.

## License

By opening a pull request you license the contribution under the [MIT License](./LICENSE).
There is no CLA and no DCO sign-off.
