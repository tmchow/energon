# Discovery documents

Discovery documents are the unauthenticated first reads on this Energon: `/v1/help` for origins, policy, and SOP, `/v1/openapi.json` for the `/v1` HTTP schema, `/v1/health` for liveness, `/llms.txt` for the agent overview, `/auth.md` for authentication instructions for connections and manual tokens, and `/.well-known/agent-skills/` for this Energon's rendered skill. They answer before a token exists.

## Sub-features

- `help` returns JSON with `hub` and `content_origin` equal to this origin, `env`, `token_prefix`, limits, retention, token policy, `sop`, and `routes`.
- `help-openapi` sets `openapi` to `$ORIGIN/v1/openapi.json` and lists `GET /v1/openapi.json` in `routes`.
- `openapi` returns OpenAPI 3.1.0 with `servers[0].url` equal to this origin, no token, CORS `*`. Every operation has a readable operationId and a tag (`deployments.createDeployment`). With a dedicated content origin, `/_deployment-grants/*` paths carry their own `servers` set to it; local runs share one origin, so those paths have none.
- `auth` returns public Markdown with this Energon's token env, token prefix, `/tokens` and `/v1/whoami` URLs, credential boundaries, and recovery instructions. `help.auth_url` and token-rejection JSON `auth_url` point to it.
- `private-install`: `/setup`, help, and llms distinguish GitHub repository access from Energon token approval and offer a local-skill or API fallback.
- `health` returns `{"ok":true}` at `/health` and `/v1/health`.
- `llms` returns markdown that links the OpenAPI contract and help.
- `agent-skills` serves `/.well-known/agent-skills/index.json` naming this Energon's skill and its files, and each listed file under `/.well-known/agent-skills/{skill}/`, bound to this origin. Help `agent_skills_url` points to it; llms carries the install line. `AGENT_SKILLS_DISCOVERY=false` turns all three off.

## How to get to it (user POV)

- Agent: `GET $ORIGIN/v1/help`, `GET $ORIGIN/v1/openapi.json`, `GET $ORIGIN/llms.txt`, `GET $ORIGIN/auth.md`, `GET $ORIGIN/v1/health`, `GET $ORIGIN/.well-known/agent-skills/index.json`. No `Authorization` header.
- Installer or tool gateway: loads the skill from help `agent_skills_url` (`npx skills add $ORIGIN -g`).
- Human: the same URLs in a browser. The hub at `$ORIGIN/` is signed-in HTML, not these documents.

## Driving it with energon-verify

Preconditions:

- Launch has printed `verify-energon launch ok`.
- Doctor has passed for `$ORIGIN`. Doctor already proves `help`, `help-openapi`, `openapi`, and `health`.

- **Help / OpenAPI / health.** Doctor already proved these. Re-save only if this change is `helpBody`, `openapi/v1.json`, or `/v1/health`.
- **Default — llms.** `GET $ORIGIN/llms.txt` is 200 `text/markdown`. Body contains `$ORIGIN/v1/openapi.json`, `$ORIGIN/v1/help`, `X-Energon-Write-Password`, and `/v1/grants`.
- **Default — Authentication.** `GET $ORIGIN/auth.md` is 200 `text/markdown`, CORS `*`, and names the token env and prefix from help. `HEAD` is 200 with no body; `POST` is 405. Help and llms link `$ORIGIN/auth.md`. `GET $ORIGIN/v1/whoami` without a credential is 401 with `auth_url=$ORIGIN/auth.md` and `tokens_url=$ORIGIN/tokens`.
- **Default — Agent skills.** Run `.agents/skills/verify-energon/bin/save --expect 200 discovery skills-index GET "$ORIGIN/.well-known/agent-skills/index.json"`. The body is JSON; set `SKILL=$(jq -r '.skills[0].name' "$EVIDENCE/discovery/skills-index.body")` and confirm `.skills[0].files` lists `SKILL.md`, `references/api.md`, and `scripts/energon_publish.py`. Run `.agents/skills/verify-energon/bin/save --expect 200 discovery skills-md GET "$ORIGIN/.well-known/agent-skills/$SKILL/SKILL.md"`; it is `text/markdown`, CORS `*`, and contains `$ORIGIN` and `$TOKEN_ENV`. Run `.agents/skills/verify-energon/bin/save --expect 200 discovery help GET "$ORIGIN/v1/help"`; `agent_skills_url` is `$ORIGIN/.well-known/agent-skills/`. Help and the skill files contain no `$TOKEN`.
- **Extra (agent-skills) — Errors.** `HEAD` of the index is 200 with no body; `POST` is 405; `GET $ORIGIN/.well-known/agent-skills/$SKILL/unlisted.md` is 404. Drive when the well-known route changes.
- **Extra (agent-skills) — Disabled (second wrangler).** Never disable the running session. `ENERGON_VERIFY_RUN=$ENERGON_VERIFY_RUN-noskills ENERGON_VERIFY_PORT=<a free port other than this run> ENERGON_VERIFY_VARS="AGENT_SKILLS_DISCOVERY:false" .agents/skills/verify-energon/bin/up`. Against that origin: the index and `SKILL.md` are 404, help `agent_skills_url` is `null`, and `/llms.txt` does not contain `.well-known/agent-skills`. Cleanup the second run and return. Drive when `AGENT_SKILLS_DISCOVERY` or its default changes.
- **Extra (openapi errors) — HEAD / 405.** `curl -sS -I "$ORIGIN/v1/openapi.json"` is 200. `POST $ORIGIN/v1/openapi.json` is 405 `method_not_allowed`. Drive when the OpenAPI route or CORS changes.
- **Extra (private-install) — Setup.** Open `$ORIGIN/setup`. Confirm the Marketplace card and copied install block name this instance and explain private GitHub access, separate credentials, and the local-skill or HTTP API fallback. Capture the page with the signed-in identity visible. Read help and llms without a token and confirm they preserve the same boundary. Actual GitHub access and client installation require the operator checks in INSTALL.md; this local Worker cannot verify them.
- **Proof.** Save llms excerpt and auth.md plus the 401 whoami JSON, the skills index, the `SKILL.md` excerpt, and help `agent_skills_url`. Do not re-download help/openapi unless Extra.

## Gotchas

- These routes skip Access and skip `ensureSchema`. A 401 here is a product bug, not a missing token.
- `/v1/help` is this Energon (origins, token env, retention). `/v1/openapi.json` is the HTTP schema. Do not treat policy numbers in help as part of the OpenAPI document.
- The well-known skill answers on the content origin. Local verify runs share one origin, so `$ORIGIN` serves it; in production the hub origin does not.
- Only `1`, `true`, or `yes` keep a set `AGENT_SKILLS_DISCOVERY` on. Unset is on.
- Doctor already covers the help origin checks. This recipe is the extra shape and error-path proof, not a second doctor.
