---
name: verify-energon
description: Drive a local Energon hub and /v1 API the way a user does — publish a site or file, mint a token, check share passwords, and capture proof. Use when verifying Energon behavior, hub UI, or the publish API.
---

# Verify Energon

Energon is a company host for files and small sites. Humans open the hub. Agents publish through `/v1`. This skill drives a **local** `wrangler dev` instance you start, not production, and not a teammate's `npm run dev` on port 8787.

Read `features/README.md` before driving. Use the matching feature file as the recipe. One convenient entry point is not a full proof when the map lists others.

Helpers live in this skill directory. Invoke them from the repo root:

```
.cursor/skills/verify-energon/bin/launch
.cursor/skills/verify-energon/bin/doctor
.cursor/skills/verify-energon/bin/mint-token verify-run
.cursor/skills/verify-energon/bin/cleanup
```

## Launch

Localhost skips Cloudflare Access. Identity is `DEV_ACCESS_EMAIL` from `.dev.vars`, else `dev@example.com`. The handle is the email local-part (`dev` for the default). Published URLs are `/{handle}/s/{slug}/` and `/{handle}/f/{id}/{filename}`.

Never use the default `.wrangler/state` directory. Never attach to an already-running server unless `bin/doctor` says that process is this run's pid.

```
export ENERGON_VERIFY_RUN=my-run          # optional; launch generates one
export ENERGON_VERIFY_PORT=18787          # default; stays off 8787
.cursor/skills/verify-energon/bin/launch
```

Launch applies D1 migrations with `--persist-to /tmp/energon-verify/$RUN/persist`, starts `npx wrangler dev --ip 127.0.0.1 --port $PORT --local --persist-to … --var PUBLIC_ORIGIN:$ORIGIN --var CONTENT_ORIGIN:$ORIGIN --show-interactive-dev-session false` in its own process group (`setsid` where available, bash job control on macOS), and waits until `GET $ORIGIN/health` returns `{"ok":true}` and `GET $ORIGIN/v1/help` echoes that same origin.

Ready when launch prints `verify-energon launch ok` and `GET $ORIGIN/health` is 200. Typical first boot is under a minute. Log: `/tmp/energon-verify/$RUN/wrangler.log`.

Two instances can run side by side: different `ENERGON_VERIFY_RUN` and `ENERGON_VERIFY_PORT` values, each with its own persist dir. If port 18787 is taken, set another free port — do not reuse 8787 unless doctor proves it is this run.

To drive an instance-policy branch, set `ENERGON_VERIFY_VARS` to space-separated `KEY:VALUE` pairs before launch; each becomes an extra `--var`. Example: `ENERGON_VERIFY_VARS="ALLOW_UNLIMITED_TOKENS:false"` for the strict-tokens recipe. Launch records the pairs as `VARS=` in `state.env`.

If launch dies with an origin mismatch, a project `.dev.vars` overrode `--var`. Align `PUBLIC_ORIGIN` and `CONTENT_ORIGIN` with the verification port, or drop those keys from `.dev.vars` for the run.

Teardown is `bin/cleanup` (kills the recorded pid / process group and the listener on that port only, deletes persist, leaves evidence).

## Doctor

Run this first whenever anything looks off, and before the first drive of a session.

```
.cursor/skills/verify-energon/bin/doctor
```

It is read-only. It checks: persist path is under `/tmp/energon-verify` (not `.wrangler/state`); recorded pid is alive; that pid (or a child in its session) owns `$PORT`; `GET /health` is `{ok:true}`; `GET /v1/help` has `hub` and `content_origin` equal to `$ORIGIN`, `env=ENERGON_TOKEN`, `token_prefix=ee_live_`, `openapi=$ORIGIN/v1/openapi.json`; `GET /v1/openapi.json` has `openapi` `3.1.0` and `servers[0].url` equal to `$ORIGIN`; `GET /` is the hub (`Publish a document, prototype, or file.`, `#pick-files`); `GET /account/data` has an email; hub bootstrap JSON has a handle.

If doctor fails, stop. Do not drive a foreign instance.

## Drive

Two surfaces, same data:

1. **HTTP** — the agent path. `curl` against `$ORIGIN`. Mint with `bin/mint-token`; then `Authorization: Bearer $TOKEN` on `/v1`. Public content URLs need no token unless a share password is set (`X-Energon-Password`).
2. **Browser** — the human path. Open `$ORIGIN/`. Stable handles: `#pick-files` (Choose files), `#pick-folder` (Choose folder), `#filepick` / `#folderpick` (hidden file inputs), `#stage-go` (Publish), `#stage-cancel` (Cancel), `#stage-slug` (`aria-label="Site slug"`), `#stage-filename` (`aria-label="Filename"`), `#stage-password`, `#q` (placeholder `Search slugs and filenames`), nav `aria-label="Pages"` with Hub / Tokens / Setup / About / Stats. Catalog row actions: `Copy URL`, `Set password` / `Change or remove password`, `Delete`, `More actions`, `Download zip` / `Download`.

Prefer HTTP for publish/read proofs; it is the documented agent user path, not a test-only API. Use the browser when the feature is hub-only (Tokens mint/revoke, drop/stage, catalog buttons, password dialogs).

Do not invent a token. Do not default to `"overwrite": true`. Do not PUT to production origins.

Load origin and token from the run state after launch/doctor:

```
# shellcheck source=/dev/null
source /tmp/energon-verify/$ENERGON_VERIFY_RUN/state.env
TOKEN=$(.cursor/skills/verify-energon/bin/mint-token verify-run)
```

`state.env` has `ORIGIN`, `PORT`, `PID`, `PERSIST`, `EVIDENCE`, `EMAIL`, and after doctor `HANDLE`. After mint-token, `TOKEN`, `TOKEN_EXPIRES_AT`, and `$STATE_DIR/token`.

### HTTP recipe shape

```
curl -sS -D /tmp/h -o /tmp/b -X POST "$ORIGIN/v1/sites" \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  --data '{"slug":"verify-site"}'
# expect 201, body.url = $ORIGIN/$HANDLE/s/verify-site/
```

Save request method+path, response status, and body into `$EVIDENCE/<feature>/`. Then GET the public URL (and a second view: hub catalog or `/v1/sites/{slug}`) so persistence is not proven by the write response alone.

### Browser recipe shape

Playwright is not a repo dependency. Use the environment's browser tools, or a one-off Playwright against `$ORIGIN` if it is already installed. Prefer role/name and the ids above over coordinates.

- Choose files: click `Choose files`, then set files on `#filepick` (the click only opens a native picker).
- One file stages a loose file (`#stage-loose` visible, `#stage-filename` filled). A folder or zip stages a site (`#stage-slug`).
- Nothing is written until `Publish`. After success, `#messages` contains a flash with the public URL and the catalog lists the slug or filename.
- Tokens: go to `/tokens`, fill the `Label` textbox, choose a lifetime in `#mint-ttl` (`aria-label="Token lifetime"`, default `3 months`), click `Mint token`. `#new-token` shows `export ENERGON_TOKEN=ee_live_…`. The list has an `Expires` column; expired rows are greyed (`tr.row-expired`) and keep only `Revoke`.

## Evidence

Put proof in `/tmp/energon-verify-evidence/$ENERGON_VERIFY_RUN/` (also printed as `EVIDENCE=` in `state.env`). Cleanup must not delete this directory.

Proof standards:

- Exercise the real user path: hub UI or `/v1` / public `/{handle}/…` URLs. Do not call `SELF.fetch`, Miniflare internals, or D1/R2 bindings directly and call it a user proof.
- Capture the action and the resulting state: the write response **and** a later GET of the public URL (and catalog or `/v1` listing).
- Verify side effects: bytes at the public URL, row in `GET /account/data` or `GET /v1/sites`, password gate status, token usable at `GET /v1/whoami`.
- A screenshot of the hub with `#who` showing the email and the new row visible is required for browser drives. HTTP drives need saved status+body files.
- Record the feature id and entry point with every artifact (`publish-site` / `http` or `hub`).
- Mocks: none. This is a local Worker with local D1 and R2. Do not stub `/v1`.

## Cleanup

```
.cursor/skills/verify-energon/bin/cleanup
```

Kills the recorded pid (process group first), then any remaining listener on **this run's port** only if it belongs to that pid/session. Deletes `/tmp/energon-verify/$RUN/persist`. Does **not** delete `/tmp/energon-verify-evidence/$RUN/`. After cleanup, confirm the evidence directory still exists.

Never `pkill -f wrangler` / `pkill -f workerd`. Never delete `.wrangler/state` (that is the human's default local DB).

Fixture objects created during a drive (sites, files, tokens) live in the persist dir and go away with it. Do not delete evidence files as fixture cleanup.

## Helpers

All executable, all from repo root:

| Command | What it does |
|---|---|
| `bin/launch` | Isolated wrangler + migrations. Prints origin, pid, persist, evidence. |
| `bin/doctor` | Read-only health/identity/ownership check. Exit 1 → do not drive. |
| `bin/mint-token [label] [ttl]` | `POST /account/tokens` with `Origin: $ORIGIN` (same path as the Tokens page). Optional `ttl` preset (`1d`…`365d`, `never`); omitted = instance default (`90d`). Prints `ee_live_…`. Saves `$STATE_DIR/token` and `TOKEN_EXPIRES_AT` in `state.env`. |
| `bin/cleanup` | Kill this run, remove persist, keep evidence. |

`bin/_lib.sh` is sourced by those scripts; do not invoke it directly.
