---
name: verify-energon
description: Drive a local Energon hub and /v1 API the way a user does — publish a site or file, mint a token, check share passwords, and capture proof. Use when verifying Energon behavior, hub UI, or the publish API.
---

# Verify Energon

Energon hosts company files and small sites. Humans open the hub. Agents publish through `/v1`. This skill drives a **local** `wrangler dev` you start, not production, and not a teammate's `npm run dev` on port 8787.

Read `features/README.md` before driving. Use the matching feature file as the recipe. Drive every **Default** bullet in that file. Drive an **Extra** bullet only when the change touches that sub-feature (named on the bullet). Do not replay the whole map. Skipping Extra is not a skipped entry point; report it as n/a with the reason.

The skill lives in `.agents/skills/verify-energon/`; `.claude/skills/verify-energon` and `.cursor/skills/verify-energon` are symlinks to it, so Claude Code, Cursor, Codex, and any host that reads `.agents/skills` all see the same files. Helpers need only `bash`, `curl`, `python3`, and `npx`, and locate the repo root from their own path, so they work from any host. Invoke them from the repo root:

```
.agents/skills/verify-energon/bin/up
# shellcheck source=/dev/null
set -a; source "/tmp/energon-verify/$(cat /tmp/energon-verify/current)/state.env"; set +a
.agents/skills/verify-energon/bin/save --expect 201 publish-site create POST "$ORIGIN/v1/sites" \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" --data '{"slug":"verify-site"}'
.agents/skills/verify-energon/bin/cleanup
```

`bin/up` is launch + doctor + ready in one process. Do not run those three as separate agent turns. Hub POSTs under `/account` need `-H "origin: $ORIGIN"`.

## Launch

Localhost skips Cloudflare Access. Identity is `DEV_ACCESS_EMAIL` from `.dev.vars`, else `dev@example.com`. The handle is the email local-part (`dev` for the default). Published URLs are `/{handle}/s/{id}/{slug}/` and `/{handle}/f/{id}/{filename}`. Site API keys by id: `/v1/sites/{id}`.

Never use the default `.wrangler/state` directory. Never attach to an already-running server unless `bin/doctor` says that process is this run's pid.

```
export ENERGON_VERIFY_RUN=my-run          # optional; launch generates one
export ENERGON_VERIFY_PORT=18787          # default; stays off 8787
.agents/skills/verify-energon/bin/up      # usual start (launch + doctor + ready)
```

`bin/launch` alone is for debugging a failed boot. After a successful `bin/up`, source `state.env` and drive.

Launch applies D1 migrations with `--persist-to /tmp/energon-verify/$RUN/persist`, starts `npx wrangler dev --ip 127.0.0.1 --port $PORT --local --persist-to … --var PUBLIC_ORIGIN:$ORIGIN --var CONTENT_ORIGIN:$ORIGIN --show-interactive-dev-session false` in its own process group (`setsid` where available, bash job control on macOS), and waits until `GET $ORIGIN/health` returns `{"ok":true}` and `GET $ORIGIN/v1/help` echoes that same origin.

Ready when launch prints `verify-energon launch ok` and `GET $ORIGIN/health` is 200. Typical first boot is under a minute. Log: `/tmp/energon-verify/$RUN/wrangler.log`.

Two runs can sit side by side: different `ENERGON_VERIFY_RUN` and `ENERGON_VERIFY_PORT` values, each with its own persist dir. If port 18787 is taken, set another free port — do not reuse 8787 unless doctor proves it is this run.

To drive a policy branch, set `ENERGON_VERIFY_VARS` to space-separated `KEY:VALUE` pairs before launch; each becomes an extra `--var`. Example: `ENERGON_VERIFY_VARS="ALLOW_UNLIMITED_TOKENS:false"` for the strict-tokens recipe. Launch records the pairs as `VARS=` in `state.env`.

If launch dies with an origin mismatch, a project `.dev.vars` overrode `--var`. Align `PUBLIC_ORIGIN` and `CONTENT_ORIGIN` with the verification port, or drop those keys from `.dev.vars` for the run.

Teardown is `bin/cleanup` (kills the recorded pid / process group and the listener on that port only, deletes persist, leaves evidence).

## Doctor

`bin/up` already runs doctor. Run it alone when launch was separate or anything looks off.

```
.agents/skills/verify-energon/bin/doctor
```

It is read-only. It checks: persist path is under `/tmp/energon-verify` (not `.wrangler/state`); recorded pid is alive; that pid (or a child in its session) owns `$PORT`; `GET /health` is `{ok:true}`; `GET /v1/help` has `hub` and `content_origin` equal to `$ORIGIN`, `env=ENERGON_TOKEN`, `token_prefix=ee_live_`, `openapi=$ORIGIN/v1/openapi.json`; `GET /v1/openapi.json` has `openapi` `3.1.0` and `servers[0].url` equal to `$ORIGIN`; `GET /` is the hub (`Publish a document, prototype, or file.`, `#pick-files`); `GET /account/data` has an email; hub bootstrap JSON has `data.handle`.

If doctor fails, stop. Do not drive a foreign run.

## Drive

One `bin/up`, one token. Do not relaunch between features. Do not start a second wrangler unless an Extra bullet names `ENERGON_VERIFY_VARS` and a second port.

If you already launched without `bin/up`, run `bin/doctor` then `bin/ready` once:

```
.agents/skills/verify-energon/bin/ready
# shellcheck source=/dev/null
set -a; source "/tmp/energon-verify/$(cat /tmp/energon-verify/current)/state.env"; set +a
```

Two surfaces, same data:

1. **HTTP** — prefer this. `bin/save` writes `$EVIDENCE/<feature>/<name>.{code,headers,body}`. Bearer `$TOKEN` on `/v1`. Public URLs need no token unless a share password is set (`X-Energon-Password`). Guest writes use `X-Energon-Write-Password`. Hub POSTs the page already uses (`/account/tokens`, `/account/connections/{id}/approve`, `/account/cleanup`) are HTTP twins — use them unless Extra is the page chrome.
2. **Browser** — Extra, when the change is hub-only. Stable ids live in the matching feature file (`#pick-files`, `#q`, `#catalog-cleanup`, …). Screenshot with Energon and `#who` only for Extra browser drives.

Do not invent a token. Do not default to `"overwrite": true`. Do not PUT to production origins.

### HTTP recipe shape

```
.agents/skills/verify-energon/bin/save --expect 201 publish-site create POST "$ORIGIN/v1/sites" \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  --data '{"slug":"verify-site"}'
# body.url = $ORIGIN/$HANDLE/s/<id>/verify-site/
```

Then GET the public URL (and catalog or `/v1/sites/{id}`) so persistence is not proven by the write response alone.

### Browser recipe shape

Use the environment's browser tools only for Extra hub bullets. Prefer `#id` over coordinates. Wait for async results.

- Choose files: click `Choose files`, then set files on `#filepick`.
- One file stages a loose file (`#stage-loose`). A folder or zip stages a site (`#stage-slug`).
- Nothing is written until `Publish`. `#messages` then contains the public URL.

## Evidence

Put proof in `/tmp/energon-verify-evidence/$ENERGON_VERIFY_RUN/` (also printed as `EVIDENCE=` in `state.env`). Cleanup must not delete this directory.

Proof standards:

- Exercise the real user path: hub UI or `/v1` / public `/{handle}/…` URLs. Do not call `SELF.fetch`, Miniflare internals, or D1/R2 bindings directly and call it a user proof.
- Capture the action and the resulting state: the write response **and** a later GET of the public URL (and catalog or `/v1` listing).
- Verify side effects: bytes at the public URL, row in `GET /account/data` or `GET /v1/sites`, password gate status, token usable at `GET /v1/whoami`.
- A screenshot of the hub with `#who` showing the email is required for Extra browser drives. HTTP drives need saved status+body files (`bin/save`).
- Record the feature id and entry point with every artifact (`publish-site` / `http` or `hub`).
- Mocks: none. This is a local Worker with local D1 and R2. Do not stub `/v1`.

## Cleanup

```
.agents/skills/verify-energon/bin/cleanup
```

Kills the recorded pid (process group first), then any remaining listener on **this run's port** only if it belongs to that pid/session. Deletes `/tmp/energon-verify/$RUN/persist`. Does **not** delete `/tmp/energon-verify-evidence/$RUN/`. After cleanup, confirm the evidence directory still exists.

Never `pkill -f wrangler` / `pkill -f workerd`. Never delete `.wrangler/state` (that is the human's default local DB).

Fixture objects created during a drive (sites, files, tokens) live in the persist dir and go away with it. Do not delete evidence files as fixture cleanup.

## Helpers

All executable, all from repo root:

| Command | What it does |
|---|---|
| `bin/up` | Launch + doctor + ready in one shot. Usual session start. |
| `bin/launch` | Isolated wrangler + migrations. Prints origin, pid, persist, evidence. |
| `bin/doctor` | Read-only health/help/ownership check. Exit 1 → do not drive. Once per session. |
| `bin/ready` | After doctor: mint a token if `state.env` has none. Prints origin/handle/evidence. Source `state.env` for `$TOKEN`. |
| `bin/save [--expect CODE] FEATURE NAME METHOD URL …` | Curl into `$EVIDENCE/FEATURE/NAME.{code,headers,body}`. Prints the status. `--expect` fails the script on mismatch. |
| `bin/mint-token [label] [ttl]` | `POST /account/tokens` (same path as the Tokens page). Optional `ttl`. Use `bin/ready` unless you need a second label. |
| `bin/cleanup` | Kill this run, remove persist, keep evidence. |

`bin/_lib.sh` is sourced by those scripts; do not invoke it directly.
