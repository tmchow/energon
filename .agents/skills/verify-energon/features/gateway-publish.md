# Gateway publish

An agent behind a tool gateway downloads the publish helper from this Energon's well-known skill and publishes local work with it. With the token in the instance token env var, the helper replaces a site from a folder. Without a token, it publishes one file or a whole folder from upload grant JSON that the token holder minted. A folder travels as one ZIP deployment; rerunning the same command resumes it.

## Sub-features

- `helper-download` serves `scripts/energon_publish.py` from the well-known skill, bound to this origin and token env var.
- `inspect` prints a file's size and sha256, or a folder's archive descriptor, idempotency key, and file list. Hidden files and symlinks are excluded by default.
- `folder-token` publishes a folder to an existing site with `--site-id` and the token from the instance token env var.
- `file-grant` publishes one file from a `new_file` grant read on stdin, with no token in the environment.
- `folder-grant` publishes a folder from a `site_deployment` grant for a deployment created with the `inspect` output.
- `resume` finishes a deployment whose archive was already uploaded, reusing the same deployment.

## How to get to it (user POV)

- Agent or gateway: read help `agent_skills_url`, fetch `$ORIGIN/.well-known/agent-skills/{skill}/scripts/energon_publish.py`, run it with `python3`.
- Token holder for a tokenless machine: `POST $ORIGIN/v1/grants`, then pass the response JSON to the machine on stdin or as a file.

## Driving it with energon-verify

Preconditions:

- `bin/up` passed and its `state.env` is sourced; `$ORIGIN`, `$TOKEN`, `$TOKEN_ENV`, `$HANDLE`, and `$EVIDENCE` are known. Run commands from the repository root.
- `jq` and `python3` are available. Discovery is on (default). Keep helper state under `$EVIDENCE` with `--state-dir` so it never touches `~/.cache`.
- Set `G="$EVIDENCE/gateway-publish"`, `H="$G/energon_publish.py"`, and `S="$G/state"`. Build a fixture folder: `mkdir -p "$G/site" && printf '<h1>gateway</h1>' > "$G/site/index.html" && printf 'body{}' > "$G/site/style.css" && printf 'secret' > "$G/site/.env"`.

- **Default — Download the helper.** `SKILL=$(curl -sS "$ORIGIN/.well-known/agent-skills/index.json" | jq -r '.skills[0].name')`. Run `.agents/skills/verify-energon/bin/save --expect 200 gateway-publish helper GET "$ORIGIN/.well-known/agent-skills/$SKILL/scripts/energon_publish.py"` and `cp "$G/helper.body" "$H"`. The script contains `$ORIGIN` and `$TOKEN_ENV`, and `python3 "$H" --help` lists `inspect`, `publish-file`, and `publish-folder`.
- **Default — Inspect.** `python3 "$H" inspect "$G/site" --state-dir "$S" > "$G/inspect.json"`. `files` is `index.html` and `style.css` only (no `.env`); `archive` has `size` and `sha256`; `idempotency_key` is set.
- **Default — Publish a folder with the token.** Run `.agents/skills/verify-energon/bin/save --expect 201 gateway-publish create POST "$ORIGIN/v1/sites" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data '{"slug":"verify-gateway"}'`; set `SITE_ID=$(jq -r .id "$G/create.body")`. Run `env "$TOKEN_ENV=$TOKEN" python3 "$H" publish-folder "$G/site" --site-id "$SITE_ID" --state-dir "$S" > "$G/folder-token.json"`. Output `state` is `committed` with `url` and `version_id`.
- **Default — Read a second view.** `.agents/skills/verify-energon/bin/save --expect 200 gateway-publish public GET "$(jq -r .url "$G/folder-token.json")"` shows `gateway`; `GET` of `.env` under the same URL is 404. Output and stderr contain no `$TOKEN`.
- **Extra (`file-grant`) — Single-file grant.** Run `.agents/skills/verify-energon/bin/save --expect 201 gateway-publish grant-file POST "$ORIGIN/v1/grants" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data '{"target":{"type":"new_file","filename":"gateway.txt"}}'`. Then `printf 'from-the-gateway' > "$G/gateway.txt"` and `env -u "$TOKEN_ENV" python3 "$H" publish-file "$G/gateway.txt" --grant-file - < "$G/grant-file.body" > "$G/file-grant.json"`. The helper prints the response body: `created: true` and a `url` under `$ORIGIN/$HANDLE/f/`; a public GET returns `from-the-gateway`; `GET $ORIGIN/v1/grants/{id}` shows `consumed`. Drive when grant handling in the helper changes.
- **Extra (`folder-grant`) — Folder grant.** Change `$G/site/index.html`, run `inspect --restart` into `$G/inspect2.json`, and read the site's generation: `.agents/skills/verify-energon/bin/save --expect 200 gateway-publish site-get GET "$ORIGIN/v1/sites/$SITE_ID" -H "Authorization: Bearer $TOKEN"` then `jq .content_generation "$G/site-get.body"`. `POST $ORIGIN/v1/sites/$SITE_ID/deployments` (createDeployment) with `{"expected_version":<generation>,"idempotency_key":<inspect idempotency_key>,"archive":<inspect archive>}` → 201. Mint `{"target":{"type":"site_deployment","deployment_id":"<returned id>"}}` into `$G/grant-folder.body`, then `env -u "$TOKEN_ENV" python3 "$H" publish-folder "$G/site" --grant-file - --state-dir "$S" < "$G/grant-folder.body"`. Output is `committed` with the same deployment id; the public URL shows the new HTML. Drive when the folder-grant path changes.
- **Extra (`resume`) — Interrupted after archive upload.** Change `index.html` again and run `python3 "$H" inspect "$G/site" --restart --state-dir "$S" > "$G/inspect3.json"`. Create the deployment as in `folder-grant` and set `DEPLOYMENT_ID` from its `deployment_id`, then upload only the archive: `curl -sS -X PUT "$ORIGIN/v1/sites/$SITE_ID/deployments/$DEPLOYMENT_ID/archive" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/zip' --data-binary @"$(jq -r .archive_path "$G/inspect3.json")"` → 200 or 201. Rerun the Default token-mode `publish-folder` command. It ends `committed` with `deployment_id` equal to `$DEPLOYMENT_ID`, and stderr has no `Uploading archive` line. Drive when resume or persisted state changes.
- **Default — Cleanup.** `.agents/skills/verify-energon/bin/save --expect 200 gateway-publish delete DELETE "$ORIGIN/v1/sites/$SITE_ID" -H "Authorization: Bearer $TOKEN"`. Keep the evidence; `$S` is empty after each commit.
- **Proof.** Helper excerpt with `$ORIGIN`, `inspect.json`, `folder-token.json`, the public GET body, and the `.env` 404. For Extra, the helper JSON outputs and grant status with secrets redacted.

## Gotchas

- The helper reads the token only from the env var the skill names (`$TOKEN_ENV`), never from argv; it refuses argv that looks like a token or grant secret. Grant JSON comes from stdin or `--grant-file`.
- Token mode needs an existing site; create it first and pass `--site-id`.
- A folder grant targets a deployment created with the exact `inspect` archive and idempotency key. A different archive is a new deployment, not a resume.
- Local verify runs share one origin, so grant URLs are on `$ORIGIN`. In production they are on the content origin, and the helper refuses grant URLs on any other origin.
- After a commit the helper drops its archive and state. A rerun after that starts a new deployment.
