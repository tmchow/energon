# Discovery documents

Discovery documents are the unauthenticated first reads on this Energon: `/v1/help` for origins, policy, and SOP, `/v1/openapi.json` for the `/v1` HTTP schema, `/v1/health` for liveness, `/llms.txt` for the agent overview, and `/auth.md` for authentication instructions for connections and manual tokens. They answer before a token exists.

## Sub-features

- `help` returns JSON with `hub` and `content_origin` equal to this origin, `env`, `token_prefix`, limits, retention, token policy, `sop`, and `routes`.
- `help-openapi` sets `openapi` to `$ORIGIN/v1/openapi.json` and lists `GET /v1/openapi.json` in `routes`.
- `openapi` returns OpenAPI 3.1.0 with `servers[0].url` equal to this origin, no token, CORS `*`.
- `auth` returns public Markdown with this Energon's token env, token prefix, `/tokens` and `/v1/whoami` URLs, credential boundaries, and recovery instructions. `help.auth_url` and token-rejection JSON `auth_url` point to it.
- `health` returns `{"ok":true}` at `/health` and `/v1/health`.
- `llms` returns markdown that links the OpenAPI contract and help.

## How to get to it (user POV)

- Agent: `GET $ORIGIN/v1/help`, `GET $ORIGIN/v1/openapi.json`, `GET $ORIGIN/llms.txt`, `GET $ORIGIN/auth.md`, `GET $ORIGIN/v1/health`. No `Authorization` header.
- Human: the same URLs in a browser. The hub at `$ORIGIN/` is signed-in HTML, not these documents.

## Driving it with energon-verify

Preconditions:

- Launch has printed `verify-energon launch ok`.
- Doctor has passed for `$ORIGIN`. Doctor already proves `help`, `help-openapi`, `openapi`, and `health`.

- **Help / OpenAPI / health.** Doctor already proved these. Re-save only if this change is `helpBody`, `openapi/v1.json`, or `/v1/health`.
- **Default — llms.** `GET $ORIGIN/llms.txt` is 200 `text/markdown`. Body contains `$ORIGIN/v1/openapi.json`, `$ORIGIN/v1/help`, and `X-Energon-Write-Password`.
- **Default — Authentication.** `GET $ORIGIN/auth.md` is 200 `text/markdown`, CORS `*`, and names the token env and prefix from help. `HEAD` is 200 with no body; `POST` is 405. Help and llms link `$ORIGIN/auth.md`. `GET $ORIGIN/v1/whoami` without a credential is 401 with `auth_url=$ORIGIN/auth.md` and `tokens_url=$ORIGIN/tokens`.
- **Extra (openapi errors) — HEAD / 405.** `curl -sS -I "$ORIGIN/v1/openapi.json"` is 200. `POST $ORIGIN/v1/openapi.json` is 405 `method_not_allowed`. Drive when the OpenAPI route or CORS changes.
- **Proof.** Save llms excerpt and auth.md plus the 401 whoami JSON. Do not re-download help/openapi unless Extra.

## Gotchas

- These routes skip Access and skip `ensureSchema`. A 401 here is a product bug, not a missing token.
- `/v1/help` is this Energon (origins, token env, retention). `/v1/openapi.json` is the HTTP schema. Do not treat policy numbers in help as part of the OpenAPI document.
- Doctor already covers the help origin checks. This recipe is the extra shape and error-path proof, not a second doctor.
