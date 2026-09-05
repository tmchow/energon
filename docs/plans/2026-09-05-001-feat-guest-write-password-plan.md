---
title: Guest write password - Plan
type: feat
date: 2026-09-05
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: conversation
review: poteto-mode interrogate 2026-09-05 (four models). Act-on items folded in.
---

# Guest write password - Plan

## Goal Capsule

- **Objective:** An instance member can let someone outside the host replace a published loose file, or write paths inside a published site (replace or add), without Access, token minting, or `/connect`. The outside agent learns the protocol from the content host.
- **Means:** A second shared secret (write password) and header, bytes-only `PUT` on the public content URL, and a Host-branched `/llms.txt` on the content origin. Hub outsider-sharing fields sit behind a collapsed disclosure.
- **Authority:** Product Contract below. STRATEGY boundaries stay: not a document editor, not a per-user ACL, last write wins, humans control credentials.
- **Stop conditions:** Stop if guest write requires a bearer token. Stop if the guest PUT path would satisfy `OWNER_WRITE_SQL` or call `putLooseFromRequest` / `putSiteFile` as-is. Stop if content-origin `/llms.txt` cannot be a different body from hub `/llms.txt` when the two origins differ.

## Problem Frame

Read sharing already works for outsiders. A public content URL, optional share password, header for agents, form plus cookie for browsers. Write still requires an instance identity. Company-plus-contractor and solo-plus-outside-collaborator have no "this one object" path.

The collaborator is agent-native. They edit in their tools and replace bytes. Energon does not grow a browser editor or a guest account.

## Key Decisions

Session-settled from this conversation, then amended by adversarial review.

- **Guest write is a per-object shared secret, not membership.** No Access user, no API Token, no `/connect`.
- **Two secrets, two headers.** `X-Energon-Password` stays read-only. `X-Energon-Write-Password` authorizes replace. Authorization is bound to the header that carried the secret. Identical phrases still do not let the read header PUT.
- **Write implies read on the agent path only.** The write header unlocks GET. The HTML gate form and cookie accept the share password only. A write secret typed into the browser form is not a goal of this slice.
- **Write proof is the write header only.** `energon_gate` never authorizes PUT, even if it was minted from a write-hash unlock in a later slice.
- **Mutation is on the content origin because that is the URL the guest was given, and because it keeps unauthenticated writes off the hub origin.** Hub `/v1` is Access Bypass already. Tokenlessness, not Access, is what blocks `/v1`. Do not put Access on `/v1` to "fix" this.
- **Do not change artifact bytes.** Discovery is errors and content-origin `/llms.txt`. Response-header `Allow: PUT` is not the teacher (cache-stale after revoke).
- **Content-origin `/llms.txt`, not `write.md`.** Classify host before serving `/llms.txt`. Content body is guest-only. Hub body stays instance SOP plus a guest-write section for publishers.
- **One authored protocol fragment in TypeScript.** Skill templates keep literals. Vitest asserts rendered skill contains the exported constants. No `skill:render` import of Worker TS.
- **Hub: collapse outsider sharing.** URL, expiry, instance write policy, and Publish stay visible. Share password and write password live behind a closed Link access disclosure.
- **Creator-only to set or clear the write password.** Same bar as `write_policy`. `canMutate` is not enough.
- **Password writer is not an account.** Guest PUT is a distinct `WriteAuthority`. It does not reuse `Actor`. It does not invent a fake email. Keep `last_written_by` as the last account. Record `written_via` (or equivalent) for hub copy ("Updated via write password").
- **A site write password is write into that site.** Guest PUT may replace or add a path under the existing slug (same as a token PUT of one file). That is how a contractor redesigns a slice. Still no new site, no new loose file, no loose-file rename, no zip, no DELETE. Guest create of a new path is bounded by `MAX_IMPORT_FILES` (200) on that site so a leaked secret cannot mint an unbounded tree. File-byte and platform-byte caps match token PUT.
- **Instance write policy stays a separate door.** Tokens still follow `owner` | `instance`. A valid write-password PUT succeeds even when `write_policy` is `owner`.

## Product Contract

### Protocol

- R1. A site or loose file may have a write password, independent of the share password. Default unset. Unset means guests cannot write.
- R2. Sites: JSON `write_password` on create and PATCH (empty string clears). Loose files: `X-Energon-Set-Write-Password` and multipart `write_password` on create, plus JSON PATCH. Duplicate never copies the write hash. Only the creator (`assertCanSetWritePolicy`) may set or clear it. Guest PUT cannot set it.
- R3. GET never returns the secret. Set responses echo it once via `secretJson` (`no-store, private`). Catalog rows expose `write_password_protected: boolean`.
- R4. Combinations: neither; read only; write only; both. Write-only is the usual contractor case (public read).
- R5. `X-Energon-Password` reads a share-passworded public URL. It never authorizes PUT, even when the phrases are identical.
- R6. `X-Energon-Write-Password` on `PUT` to the public URL replaces bytes. Body is raw bytes only. Reject multipart, `X-Filename`, `X-Energon-Set-Password`, `X-Energon-Set-Write-Password`, TTL, and write-policy headers on guest PUT with 400.
- R7. Cookie and gate form never authorize PUT.
- R8. PUT status matrix:
  - no write password set → `405` with `Allow: GET` (do not name the write header)
  - write password set, header missing or wrong → `401` JSON naming `X-Energon-Write-Password` and `GET {content_origin}/llms.txt`
  - site or loose file missing → `404` JSON (not HTML)
  - new site path that would exceed `MAX_IMPORT_FILES` on that site → `413` (same 200-file ceiling as zip import)
  - expired → `410`
  - oversize / platform storage cap → `413` (same caps as token PUT)
  - success → `200` replace or `201` create (no `api_url`, no `hub`)
- R9. Write header on GET skips the share gate. Form and cookie stay share-password only.
- R10. Rate-limit wrong write secrets on write-specific object and IP scopes. Wrong read secrets stay on read scopes. Twenty failed writes must not block share-password GET. `wantsJsonGate` is true if either password header is present.
- R10b. Distinct hash prefix for write secrets (`energon-wpw:` or equivalent) so a leaked read-hash table is not a write-hash table.

### Content host

- R11. Content origin `PUT` on `/{handle}/f/{id}/{filename}` and `/{handle}/s/{slug}/{path}` when the write header matches. Loose-file PUT requires handle, id, and filename to match the row (no 302) and only replaces that file. Site PUT creates or replaces that path under the existing site (`assertFilePath`). `PUT` to a directory URL (`…/s/{slug}/`) is `400` JSON naming the resolved index path if one exists, or telling them to PUT `index.html` / `index.md`. Same file-byte and platform-byte caps as token PUT. A new path is refused when the site already has `MAX_IMPORT_FILES` files. Same 410 for expired or purge-claimed objects. Content `/llms.txt` says a site write password can add paths, not only overwrite.
- R12. Guest mutation uses `WriteAuthority` `{ kind: "writePassword", hash }` distinct from `Actor`. Lookup by public URL handle, not `findSiteForActor`. Do not call `putLooseFromRequest` or `putSiteFile` unchanged. Do not satisfy `OWNER_WRITE_SQL` with a fake actor. Loose-file claim/UPDATE includes `write_password_hash = ?` bound to the verified hash (clear/rotate during PUT is 401, not a late write). Site PUT keeps today's R2 snapshot + D1 rollback; the authorize-and-write predicate must still include the current write hash. Sites do not grow a new write-claim table in this slice.
- R13. Successful guest PUT purges cache prefixes, updates `updated_at`, sets `written_via` (name TBD, not an email in `last_written_by`). Creator remains in `scope=involved` via `owner_id` or `created_by` even when `owner_id` is null. Hub Last writer stays the last account; show "Updated via write password" from `written_via`. PATCH that sets or clears `write_password` purges the same prefixes as share-password PATCH.
- R14. GET never prepends protocol text to the body.
- R15. Do not send `Allow: PUT` on cacheable GET. The 401 body is the teacher. Optional `Link: </llms.txt>; rel="describedby"` on content GET is allowed if it does not claim the object is writable.
- R16. Classify `contentHost` before `/llms.txt`, `/auth.md`, `/v1/help`, `/v1/openapi.json`. Content origin serves the guest `/llms.txt` body. Content origin 404s `/auth.md` and `/v1/*` (or equivalent "this hostname serves published content only") so guests are not taught `/connect`. When `PUBLIC_ORIGIN == CONTENT_ORIGIN` (local/verify), `/llms.txt` is the hub body with the guest-write section included, and the verify recipe asserts that section rather than two Hosts.
- R17. Content `/llms.txt` describes guest public-URL use only. No `/v1`, `/auth.md`, `/tokens`, `/connect` as the way to write.
- R28. Authorize and rate-limit guest PUT before reading the body. No CORS `*` for PUT. No OPTIONS that allows `X-Energon-Write-Password` from arbitrary origins. Guest write is for non-browser agents. Hub-origin PUT to a content path is `307`/`308` or JSON naming the content origin (not a 302 that becomes GET).

### Drift

- R18. One TypeScript module exports header names, 401/405 copy, content `llms.txt` body, and hub SOP lines. `config.ts` keeps the header constants. Skill templates contain the same literals. `skill-render.spec.ts` imports the TS constants and asserts they appear in the rendered skill.
- R19. Goldens freeze hub `llms.txt`, content `llms.txt`, and `helpBody` SOP. A unit test asserts the fragment appears in hub llms, content llms, and help. Content golden must not mention `/v1`, `/auth.md`, `/tokens`, or `/connect`.
- R20. `write_password` on `/v1` create/PATCH goes into `openapi/v1.json`. Guest PUT is not a `/v1` path. Any new `ApiError` code still has to appear in OpenAPI because openapi-drift scans all of `src/`. Prefer reusing `password_required` for wrong write secret, with a message that names the write header. `405` for unset may reuse `method_not_allowed`.

### Hub UI

- R21. Stage primary: URL, expiration, Who can write (instance door), Publish. Closed disclosure "Link access" holds share password and write password. Open the disclosure when either field is non-empty. Overwrite ("Write into it") must still send write password if staged.
- R22. Write policy stays visible. Note that it does not grant or deny the write-password door.
- R23. Catalog lock opens one Link access dialog. Each secret is `unchanged | replace | remove`. Empty box does not clear the other secret. Lock `on` if either hash is set. Badge `password` if share-passworded. Second badge if write-passworded (not "edit", not a role). Copy: instance tokens still follow write policy; write password is for someone not on this host. Non-creators do not get the write-password fields.
- R24. Gate page stays a share-password unlock. Do not accept the write secret in the form. DESIGN.md: lock `on` if either shared secret is set. CONCEPTS.md gains Write Password. STRATEGY.md "shared writes happen through in-place replacement under write policy" needs a clause for the write-password door.

### Skill, help, verify

- R25. Instance skill: scenario "outside agent updates this URL." Creator sets write password, human sends public URL plus write password, outside agent `GET {content_origin}/llms.txt` (or reads the guest section of hub `/llms.txt` on single-origin) and PUT with `X-Energon-Write-Password`. Do not mint them a token.
- R26. `helpBody` and hub `llms.txt` describe both doors. `auth.md` (hub only): a write password is an object-scoped shared secret for public-URL PUT, not an account token, not Access.
- R27. verify-energon: new recipe plus updates to `share-password.md` and hub-catalog handles this change moves (`#stage-password` disclosure, dialog title, both fields, lock `on` for write-only). Proofs: guest PUT without `Authorization`; guest PUT of a new site path (`201`); read header cannot PUT; cookie cannot PUT; identical phrases still header-bound; `write_policy=owner` guest PUT succeeds; creator-only set; clear write password then PUT 405; 405 when unset (no write header named); content vs hub `/llms.txt` when origins differ, guest section present when they do not; catalog still shows the object after guest PUT.

### Success Criteria

- An outside agent given the public URL and a write password can replace a loose file, replace a site path, or add a new path under that site, without a token.
- A viewer given only the share password cannot PUT.
- A human who only unlocks the gate cannot cause a PUT via the cookie.
- Changing guest-write copy in the TS module fails CI if hub llms, content llms, help, or the rendered skill disagree.
- A coworker token cannot mint a write password on someone else's `owner` object.

## Hub UI shape

```
[ drop zone ]
URL
Expiration
Who can write
▸ Link access          ← closed: share password, write password
[ Cancel ] [ Publish ]
```

Flash must echo two secrets independently when both were just set.

## Sourcing map

| Surface | Audience | Guest-write text |
| --- | --- | --- |
| Shared TS module + `config.ts` headers | authors | source |
| Hub `/llms.txt` | instance agents | full SOP + guest section |
| Content `/llms.txt` | guest agents | guest body only (when origins differ) |
| `helpBody()` | instance agents | SOP + create/PATCH fields |
| `templates/skill/` | instance agents | literals, asserted against TS constants |
| `openapi/v1.json` | `/v1` create/PATCH | `write_password` field; error codes used in `src/` |
| `auth.md` | hub only | object-scoped secret, not account token |
| CONCEPTS.md, STRATEGY.md, DESIGN.md | humans | terms and the extra door |
| Goldens + skill-render + fragment test | CI | freeze |
| verify-energon feature map | same PR | handles this change moves |

## Schema (planning note)

Additive `write_password_hash` on `sites` and `loose_files`. Additive `written_via` (or equivalent) rather than stuffing a sentinel into `last_written_by`. New migration, `ensureColumns`, `src/schema.sql`. Distinct hash prefix from share passwords. Clearing the write password is revocation and must be visible to in-flight guest claims.

## Out of scope

- Browser upload or editor on the unlocked page
- Named invites, guest API tokens
- Zip import / DELETE of a site path via write password (stale files stay until the owner or an instance token deletes them)
- Injecting protocol into file bytes
- Per-person revoke
- Fixing the pre-existing concurrent gate limiter
- Guest write-event audit table (later; STRATEGY revision-share instrumentation)
- CORS-enabled browser PUT
- Public `Allow: PUT` on cacheable GET
- `skill:render` importing Worker TypeScript

## Verification (when implementing)

- `test:unit` goldens, fragment drift, skill-render, gate/password, openapi-drift
- `test/api.spec.ts` status matrix, new site path `201`, file-count ceiling, header-bound identical phrases, cookie refused, owner-policy guest PUT, creator-only set, duplicate drops write hash
- `test/files.spec.ts` guest PUT rejects rename and set-password headers
- `test/site-integrity.spec.ts` hash-in-predicate vs clear mid-flight
- `test/api.purge-claim.spec.ts` expired/purge-claimed guest PUT
- `test/routes.spec.ts` Host-branched `/llms.txt`, content-host `/auth.md` 404, hub-origin PUT redirect
- `test/pages.spec.ts` disclosure, dialog unchanged/replace/remove, badges, lock on
- `check:ui`
- verify-energon recipe updates listed in R27

## Adversarial review (2026-09-05)

Four-model interrogate. Consensus that would have shipped bugs is folded above.

**Act on (folded).** Guest PUT is not `putLooseFromRequest`. `WriteAuthority` not a fake `Actor`. Bytes-only. Header-bound even when phrases match. Content `/llms.txt` is a Host branch of an existing public route, not a new 404 exception. Access is not why `/v1` is closed. Creator-only set. Hash in the claim predicate. Split rate-limit scopes. Do not put a sentinel in `last_written_by`. 405 when unset. No cacheable `Allow: PUT`. Purge on write-password PATCH. No CORS for PUT. Form does not take the write secret. Dialog omit vs clear per field. skill-render asserts constants. Single-origin `/llms.txt` rule. OpenAPI still lists every `ApiError` code. Verify map handles this change moves.

**Product override after review.** Reviewers wanted guest site PUT to 404 on missing paths (storage bomb, extra HTML on the company hostname). The product call is that a site write password is write into that site, including new paths, with the 200-file and byte caps. Unbounded trees stay out. Guest DELETE and zip stay out, so a redesign can leave stale paths.

**Dismissed.** Concurrent gate burst rewrite (pre-existing sequential limiter, not this feature). PBKDF2 for write hashes (distinct prefix is the slice; share passwords already SHA-256). Full write-event table (instrument later). Public HEAD as a vehicle for `Allow: PUT` (HEAD is unscoped; do not add it to advertise write).

**Open (do not block).** Badge phrasing (`write password` vs `writable`). Exact `written_via` column name. Whether content-host `/v1/help` is 404 or a one-line "published content only."

## Open questions

- Badge label. Prefer `write password`.
- `written_via` vs `last_writer_kind`.
