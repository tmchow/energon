# Discovery documents

Discovery documents are the unauthenticated first reads on a host: `/v1/help` for this instance's identity and policy, `/v1/openapi.json` for the `/v1` HTTP schema, `/v1/health` for liveness, `/llms.txt` for the agent overview, and `/auth.md` for authentication instructions for connections and manual tokens. They answer before a token exists.

## Sub-features

- `help` returns JSON with `hub` and `content_origin` equal to this origin, `env`, `token_prefix`, limits, retention, token policy, `sop`, and `routes`.
- `help-openapi` sets `openapi` to `$ORIGIN/v1/openapi.json` and lists `GET /v1/openapi.json` in `routes`.
- `openapi` returns OpenAPI 3.1.0 with `servers[0].url` equal to this origin, no token, CORS `*`.
- `auth` returns public Markdown with this instance's token env, token prefix, `/tokens` and `/v1/whoami` URLs, credential boundaries, and recovery instructions. `help.auth_url` and token-rejection JSON `auth_url` point to it.
- `health` returns `{"ok":true}` at `/health` and `/v1/health`.
- `llms` returns markdown that links the OpenAPI contract and help.

## How to get to it (user POV)

- Agent: `GET $ORIGIN/v1/help`, `GET $ORIGIN/v1/openapi.json`, `GET $ORIGIN/llms.txt`, `GET $ORIGIN/auth.md`, `GET $ORIGIN/v1/health`. No `Authorization` header.
- Human: the same URLs in a browser. The hub at `$ORIGIN/` is signed-in HTML, not these documents.

## Driving it with energon-verify

Preconditions:

- Launch has printed `verify-energon launch ok`.
- Doctor has passed for `$ORIGIN`. Doctor already proves `help`, `help-openapi`, `openapi`, and `health`.

- **Help identity.** `GET $ORIGIN/v1/help` is 200. `hub` and `content_origin` equal `$ORIGIN`. `openapi` is `$ORIGIN/v1/openapi.json`. `routes["GET /v1/openapi.json"]` mentions no auth. Save as `$EVIDENCE/discovery/help.json`.
- **OpenAPI contract.** `GET $ORIGIN/v1/openapi.json` is 200. Body `openapi` is `3.1.0`. `servers[0].url` equals `$ORIGIN`. Header `access-control-allow-origin` is `*`. `paths["/v1/sites"].post.operationId` is `createSite`. Save as `$EVIDENCE/discovery/openapi.json`.
- **HEAD.** `curl -sS -I "$ORIGIN/v1/openapi.json"` is 200.
- **Wrong method.** `POST $ORIGIN/v1/openapi.json` is 405 with `error` `method_not_allowed`.
- **llms.** `GET $ORIGIN/llms.txt` is 200 `text/markdown`. Body contains `$ORIGIN/v1/openapi.json` and `$ORIGIN/v1/help`.
- **Authentication.** `GET $ORIGIN/auth.md` is 200 `text/markdown`, CORS `*`, and names the token env and prefix from help. `HEAD` is 200 with no body; `POST` is 405. Help and llms link `$ORIGIN/auth.md`. `GET $ORIGIN/v1/whoami` without a credential is 401 with `auth_url=$ORIGIN/auth.md` and `tokens_url=$ORIGIN/tokens`. Save Markdown and rejection JSON.
- **Proof.** Save help JSON, openapi excerpt (`openapi`, `servers`, path keys), HEAD headers, 405 body, and an llms excerpt that names the contract.

## Gotchas

- These routes skip Access and skip `ensureSchema`. A 401 here is a product bug, not a missing token.
- `/v1/help` is this instance (origins, token env, retention). `/v1/openapi.json` is the HTTP schema. Do not treat policy numbers in help as part of the OpenAPI document.
- Doctor already covers the identity checks. This recipe is the extra shape and error-path proof, not a second doctor.
