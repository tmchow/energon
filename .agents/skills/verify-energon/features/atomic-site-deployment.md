# Atomic site deployment

Stage a full site replacement, verify that readers retain the old content until commit, then recover the same receipt after retrying publication.

## Sub-features

- `staging` keeps uploaded candidates private until explicit commit.
- `replacement` publishes a complete file set and removes omitted paths.
- `receipt` recovers the same version after a repeated commit.
- `conflict` refuses a stale base generation.
- `grant` authorizes the same workflow through a session-bound content-origin secret.
- `hub-folder` publishes a folder once and recovers an interrupted upload.

## How to get to it (user POV)

- Token API: create a site, then `/v1/sites/{id}/deployments` and its returned session status URL.
- Tokenless uploader: mint a `site_deployment` grant and use only its returned content-origin URLs.
- Compatibility import: POST `/v1/sites/{id}/import` with `Prefer: respond-async`, then prepare and commit the returned session.

## Driving it with energon-verify

Preconditions:

- `bin/up` passed and its `state.env` is sourced; `$ORIGIN`, `$TOKEN`, and `$EVIDENCE` are known. Run commands from the repository root. Use this existing local run.
- `jq`, `python3`, and `shasum` are available. Save grant secrets only in the temporary run artifacts; redact them in reports.

- **Default — Create a fixture.** Run `.agents/skills/verify-energon/bin/save --expect 201 atomic-site create POST "$ORIGIN/v1/sites" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data '{"slug":"verify-atomic"}'`. Set `SITE_ID=$(jq -r .id "$EVIDENCE/atomic-site/create.body")` and `SITE_URL=$(jq -r .url "$EVIDENCE/atomic-site/create.body")`.
- **Default — Publish old bytes.** Run `.agents/skills/verify-energon/bin/save --expect 201 atomic-site old PUT "$ORIGIN/v1/sites/$SITE_ID/files/old.txt" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: text/plain' --data-binary 'old'`. Then `.agents/skills/verify-energon/bin/save --expect 200 atomic-site baseline GET "$ORIGIN/v1/sites/$SITE_ID" -H "Authorization: Bearer $TOKEN"`.
- **Default — Build the exact intent.** Run `printf new > "$EVIDENCE/atomic-site/new.txt"`; `GEN=$(jq -r .content_generation "$EVIDENCE/atomic-site/baseline.body")`; `HASH=$(shasum -a 256 "$EVIDENCE/atomic-site/new.txt" | cut -d ' ' -f 1)`; `KEY=$(python3 -c 'import time,uuid; print(str(int(time.time()*1000))+"."+str(uuid.uuid4()))')`; `jq -n --argjson generation "$GEN" --arg hash "$HASH" --arg key "$KEY" '{expected_version:$generation,idempotency_key:$key,files:[{path:"new.txt",size:3,sha256:$hash,content_type:"text/plain"}]}' > "$EVIDENCE/atomic-site/intent.json"`. Then `.agents/skills/verify-energon/bin/save --expect 201 atomic-site session POST "$ORIGIN/v1/sites/$SITE_ID/deployments" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary "@$EVIDENCE/atomic-site/intent.json"`. Set `DEPLOYMENT_ID=$(jq -r .deployment_id "$EVIDENCE/atomic-site/session.body")` and `SESSION_URL="$ORIGIN/v1/sites/$SITE_ID/deployments/$DEPLOYMENT_ID"`.
- **Default — Stage and inspect.** Run `.agents/skills/verify-energon/bin/save --expect 201 atomic-site upload PUT "$SESSION_URL/files/new.txt" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: text/plain' --data-binary "@$EVIDENCE/atomic-site/new.txt"`; then `.agents/skills/verify-energon/bin/save --expect 200 atomic-site still-old GET "${SITE_URL%/}/old.txt"`. The public body remains `old`.
- **Default — Prepare then explicitly publish.** Run `.agents/skills/verify-energon/bin/save --expect 200 atomic-site prepare POST "$SESSION_URL/prepare" -H "Authorization: Bearer $TOKEN"`; then `.agents/skills/verify-energon/bin/save --expect 200 atomic-site commit POST "$SESSION_URL/commit" -H "Authorization: Bearer $TOKEN"`. The response state is committed with a version ID.
- **Default — Read a second view.** Run `.agents/skills/verify-energon/bin/save --expect 200 atomic-site public-new GET "${SITE_URL%/}/new.txt"` and `.agents/skills/verify-energon/bin/save --expect 404 atomic-site omitted GET "${SITE_URL%/}/old.txt"`. The first body is `new` and its `X-Energon-Site-Version` matches the commit. Run `.agents/skills/verify-energon/bin/save --expect 200 atomic-site replay POST "$SESSION_URL/commit" -H "Authorization: Bearer $TOKEN"`; the version ID is unchanged.
- **Extra (`grant`) — Content-origin workflow.** Create a fresh session as above, then mint `POST /v1/grants` with `{"target":{"type":"site_deployment","deployment_id":"<returned id>"}}`. Using only the returned secret as bearer, PUT the declared file to `upload_url` after replacing `{path}`, POST `prepare_url`, POST `commit_url`, and GET `status_url`. Capture 201/200/200/200 and the same committed version; the original API token must not be sent to these URLs.
- **Extra (`conflict`) — Competing generation.** Create two distinct sessions against one generation. Prepare both and commit one; commit the other must return 409 `deployment_conflict`. Public bytes remain those of the winner.
- **Extra (`hub-folder`) — Folder retry and reload.** In the Hub choose a folder with `index.html`, a stylesheet, and a filename containing a space. Publish while interrupting one file request. The form must retain the selected files, lock its site settings, and offer **Retry publication**; the uploaded HTML must still return 404 publicly. Retry and confirm that already stored files are skipped within the same deployment. Once all inputs are stored, interrupt commit, reload, and use **Resume publication**. Confirm one published version, all three public files, and a cleared pending session. Repeat the paused state with **Cancel publication** and confirm that no candidate becomes public. Inspect desktop and mobile layouts.
- **Default — Cleanup.** Run `.agents/skills/verify-energon/bin/save --expect 200 atomic-site delete DELETE "$ORIGIN/v1/sites/$SITE_ID" -H "Authorization: Bearer $TOKEN"`. Retain the proof artifacts.

## Gotchas

- Preparation never authorizes implicit publication. A ZIP may need repeated 202 preparation responses before it is ready.
- New sessions replace; compatibility imports merge. The intent must include every desired path for replacement.
- Sessions expire after one hour; commit receipts last seven days. Do not change the identity after a lost response.
- Each request selects a version independently. This recipe does not establish page-wide pinning, deployed resource limits, multipart cleanup quiescence, or cache-rollout safety.
