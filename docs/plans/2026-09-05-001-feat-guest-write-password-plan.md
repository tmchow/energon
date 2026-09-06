---
title: Guest write password - Plan
type: feat
date: 2026-09-05
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: conversation
review: poteto-mode interrogate 2026-09-05 (four models on v1). Scope-delta interrogate 2026-09-05 (four models on file-vs-site add/delete).
---

# Guest write password - Plan

## Goal Capsule

- **Objective:** An instance member can let someone outside the host update a published loose file, or write into a published site (add, replace, or delete paths), without Access, token minting, or `/connect`. The outside agent learns the protocol from the content host.
- **Means:** A second shared secret (write password) and header, bytes-only `PUT` (and site-path `DELETE`) on the public content URL, and a Host-branched `/llms.txt` on the content origin. Hub outsider-sharing fields sit behind a collapsed disclosure.
- **Authority:** Product Contract below. STRATEGY boundaries stay: not a document editor, not a per-user ACL, last write wins, humans control credentials.
- **Stop conditions:** Stop if guest write requires a bearer token. Stop if guest PUT or DELETE would satisfy `OWNER_WRITE_SQL` or call `putLooseFromRequest`, `putLooseFile`, `putSiteFile`, `deleteSiteFile`, `deleteSite`, `deleteLooseFile`, or the loose-file claim helpers as-is. Stop if content-origin `/llms.txt` cannot be a different body from hub `/llms.txt` when the two origins differ.

## Problem Frame

Read sharing already works for outsiders. A public content URL, optional share password, header for agents, form plus cookie for browsers. Write still requires an instance identity. Company-plus-contractor and solo-plus-outside-collaborator have no "this one object" path.

The collaborator is agent-native. They edit in their tools and replace bytes. Energon does not grow a browser editor or a guest account.

## Key Decisions

Session-settled from this conversation, then amended by adversarial review.

- **Guest write is a per-object shared secret, not membership.** No Access user, no API Token, no `/connect`.
- **Two secrets, two headers.** `X-Energon-Password` stays read-only. `X-Energon-Write-Password` authorizes PUT, and site-path DELETE. Authorization is bound to the header that carried the secret. Identical phrases still do not let the read header PUT or DELETE.
- **Write implies read on the agent path only.** The write header unlocks GET. The HTML gate form and cookie accept the share password only. A write secret typed into the browser form is not a goal of this slice.
- **Write proof is the write header only.** `energon_gate` never authorizes PUT or DELETE, even if it was minted from a write-hash unlock in a later slice.
- **Mutation is on the content origin because that is the URL the guest was given, and because it keeps unauthenticated writes off the hub origin.** Hub `/v1` is Access Bypass already. Tokenlessness, not Access, is what blocks `/v1`. Do not put Access on `/v1` to "fix" this.
- **Do not change artifact bytes.** Discovery is errors and content-origin `/llms.txt`. Response-header `Allow: PUT` is not the teacher (cache-stale after revoke).
- **Content-origin `/llms.txt`, not `write.md`.** Classify host before serving `/llms.txt`. Content body is guest-only. Hub body stays instance SOP plus a guest-write section for publishers.
- **One authored protocol fragment in TypeScript.** Skill templates keep literals. Vitest asserts rendered skill contains the exported constants. No `skill:render` import of Worker TS.
- **Hub: collapse outsider sharing.** URL, expiry, instance write policy, and Publish stay visible. Share password and write password live behind a closed Link access disclosure.
- **Creator-only to set or clear the write password.** Same bar as `write_policy`. `canMutate` is not enough.
- **Password writer is not an account.** Guest PUT and path DELETE use a distinct `WriteAuthority`. They do not reuse `Actor`. They do not invent a fake email or put `guest` in Last writer. Keep `last_written_by` as the last account. Record `written_via` for hub copy ("Updated via shared write"). The collaborator has no handle; the annotation is how, not who.
- **Catalog password slot is one mark, never lock beside pencil.** View password only: the existing padlock. Write password present (write-only or view+write): the agreed diagonal lockup — lock northwest, filled pencil (wide body, tip, eraser) southeast, one composed mark. Draw glyphs at **36px minimum**. Do not place a padlock and a pencil as horizontal siblings. Do not fuse a tiny pencil onto the lock body. Do not use a `write password` or `shared write` chip as the scan. Org-write exception is a third family and may sit next to the password mark. People are overlapping (front person complete, companion peeking). Two equal rings over a connected double-hump are out (reads as a face). Off = the same people plus an X badge; badge circle stroke is thinner than the people (~1.15 vs 1.75). When password and org marks appear together, each sits in a matching hairline tile so the smaller lock is not read as a qualifier on the group. Tile padding is still being judged in the Hub; 4px inset is cramped. Keep the 36px glyph and grow the tile (8px inset → 54px tile, 12px inset → 62px tile).
- **Scope follows the object kind.** (session-settled: user-directed) A write password on a loose file only replaces that file's bytes, including empty. It does not `DELETE` the file, create another file, or create a site. The public file URL (handle, id, filename) is minted once and cannot be reconstituted after `DELETE`. Empty overwrite stays `200` at that URL. A write password on a site may `PUT` (add or replace) and `DELETE` paths under that slug. Path URLs may 404 after delete. The site address `/{handle}/s/{slug}/` must keep resolving (`200`, including the empty-site listing) even if every path is gone. Guest `DELETE` of the site is out. Guest create of a new site path is bounded by `MAX_IMPORT_FILES` (200) on that site, `400 too_many_files` when the path is new and the site is already at the ceiling. Replace and DELETE remain allowed at 200 files. File-byte and platform-byte caps match token PUT. A site write password is full control of that site's served bytes, including replacing `index.html`. Hub copy must say so.
- **Instance write policy stays a separate door.** Tokens still follow `owner` | `instance`. A valid write-password PUT succeeds even when `write_policy` is `owner`.

## Product Contract

### Protocol

- R1. A site or loose file may have a write password, independent of the share password. Default unset. Unset means guests cannot write.
- R2. Sites: JSON `write_password` on create and PATCH (empty string clears). Loose files: `X-Energon-Set-Write-Password` and multipart `write_password` on create, plus JSON PATCH. Duplicate never copies the write hash. Only the creator (`assertCanSetWritePolicy`) may set or clear it. Guest PUT cannot set it.
- R3. GET never returns the secret. Set responses echo it once via `secretJson` (`no-store, private`). Catalog rows expose `write_password_protected: boolean`.
- R4. Combinations: neither; read only; write only; both. Write-only is the usual contractor case (public read).
- R5. `X-Energon-Password` reads a share-passworded public URL. It never authorizes PUT or DELETE, even when the phrases are identical.
- R6. `X-Energon-Write-Password` on `PUT` writes bytes. Body is raw bytes only (empty is allowed). Reject multipart, `X-Filename`, `X-Energon-Set-Password`, `X-Energon-Set-Write-Password`, `X-Energon-Duplicate-From`, TTL, and write-policy headers on guest PUT with 400. On a site file path (normalized path non-empty), `DELETE` with the same header removes that one path. No prefix delete. Method is decided from URL kind before any secret check. Loose file: GET and PUT only. Site file path: GET, PUT, and DELETE. Site directory (normalized path empty: `…/s/{slug}` or `…/s/{slug}/`): GET only. Never-guest methods return `405` with `Allow` for that kind and do not check the write secret (no 401 oracle). `DELETE` carrying those rejected headers is ignored or 400, never a mutation.
- R7. Cookie and gate form never authorize PUT or DELETE.
- R8. Ordered status for guest PUT/DELETE:
  1. object missing → `404` JSON
  2. expired or purge-claimed → `410` JSON
  3. method not allowed for that URL kind → `405` with `Allow` for the kind (no write-header name)
  4. write rate limit → `429`
  5. write password unset, on an allowed method → `405` with `Allow: GET` (no write-header name)
  6. write password set, header missing or wrong, on an allowed method → `401` JSON naming `X-Energon-Write-Password` and content `/llms.txt`
  7. forbidden request headers on PUT → `400`
  8. new site path at `MAX_IMPORT_FILES` → `400 too_many_files` (replace and DELETE still ok)
  9. oversize / platform cap → `413`
  10. PUT success → `200` replace or `201` create
  11. site-path DELETE success → `200` JSON `{ deleted: true, path }` (not 204)
  Guest error bodies on the content host omit `hub` and hub-origin URLs. `409` busy/lost is retryable and named in content `/llms.txt`.
- R9. Guest PUT and DELETE are authorized before `protectContent`. A valid write header skips the share gate on GET, PUT, and site-path DELETE and does not consult read rate-limit scopes. Cookie and form never mutate.
- R10. Rate-limit wrong write secrets on write-specific object and IP scopes. Wrong read secrets stay on read scopes. Twenty failed writes must not block share-password GET. `wantsJsonGate` is true if either password header is present.
- R10b. Distinct hash prefix for write secrets (`energon-wpw:` or equivalent) so a leaked read-hash table is not a write-hash table.

### Content host

- R11. Loose-file PUT: after the same decode+basename as GET, the filename segment must equal `urlFilename(row.filename)` (spaces already underscores). Mismatch → `404` JSON, no 302. Empty PUT stores a zero-byte R2 object; later GET of that public URL is `200` with length 0. Guest loose-file PUT keeps the stored `content_type` and R2 `httpMetadata.contentType`; ignore the request `Content-Type` (filename is frozen; `nosniff` makes type a boundary). Site path PUT still uses `contentTypeFor(path, bytes, hint)` because the guest chooses the path. Site PUT/DELETE: one `assertFilePath` row. Empty normalized path is directory (`405`). Nested trailing slash is the file name after `normalizeRelPath`, not a prefix delete. Last-path DELETE does not delete the `sites` row. `GET /{handle}/s/{slug}/` stays `200` (empty listing if no index). Guest DELETE uses hash-guarded D1 first, then R2, then `releaseStorage` of the previous size, then purge. Guest empty/shrinking PUT releases the previous-minus-new size after commit. Predicate includes `write_password_hash = ?` and not purge-claimed. New `site_files` rows set `last_written_by` to the site's current account writer (`sites.last_written_by` if it looks like an email, else `created_by`), never a guest sentinel. `sites.last_written_by` stays the last account. `written_via` is set on guest PUT and guest path DELETE and cleared on the next account mutation.
- R2b. Present `write_password` on `overwrite: true` or any create-into-existing requires `assertCanSetWritePolicy`. Hub only sends it on overwrite when the signed-in user is the creator.
- R12. Guest mutation uses `WriteAuthority` `{ kind: "writePassword", hash }` distinct from `Actor`. Lookup by public URL handle, not `findSiteForActor`. Do not call `putLooseFromRequest`, `putSiteFile`, or `deleteSiteFile` unchanged. Do not satisfy `OWNER_WRITE_SQL` with a fake actor. Loose-file claim/UPDATE includes `write_password_hash = ?` bound to the verified hash (clear/rotate during PUT is 401, not a late write). Site PUT/DELETE keep today's R2 snapshot + D1 rollback; the predicate must still include the current write hash. Sites do not grow a new write-claim table in this slice. Guest never calls `deleteSite` or `deleteLooseFile`.
- R13. Guest PUT and path DELETE purge cache prefixes and bump `sites`/`loose_files.updated_at`. They set `written_via` on those parent rows. They do not change `last_written_by` on the parent. Hub Last writer stays the last account (never `guest`). Show "Updated via shared write" from `written_via`. Account PUT/PATCH/import/delete clears `written_via`. PATCH that sets or clears `write_password` purges the same prefixes as share-password PATCH. Catalog involvement is unchanged because guest writes do not modify parent `last_written_by`. The column name is `written_via`, not `last_writer_kind`.
- R14. GET never prepends protocol text to the body.
- R15. Do not send `Allow: PUT` on cacheable GET. The 401 body is the teacher. Optional `Link: </llms.txt>; rel="describedby"` on content GET is allowed if it does not claim the object is writable.
- R16. Classify `contentHost` before `/llms.txt`, `/auth.md`, `/v1/help`, `/v1/openapi.json`. Content origin serves the guest `/llms.txt` body. Content origin does not serve `helpBody`. `/auth.md` and `/v1/*` on the content origin are `404` JSON `{ error: "not_found", message: "This hostname serves published content only. GET /llms.txt on this host." }` so a lost agent has one hop and is not taught `/connect`. When `PUBLIC_ORIGIN == CONTENT_ORIGIN` (local/verify), `/llms.txt` is the hub body with the guest-write section included, and the verify recipe asserts that section rather than two Hosts. `/v1/help` on that single origin stays the hub document.
- R17. Content `/llms.txt` describes guest public-URL use only. A site write password can PUT or DELETE a path under that slug. A file write password can only PUT that file. No delete of the site or the loose file. No `/v1`, `/auth.md`, `/tokens`, or `/connect` as the way to write.
- R28. Authorize and rate-limit guest PUT before reading the body. No CORS `*` for PUT. No OPTIONS that allows `X-Energon-Write-Password` from arbitrary origins. Guest write is for non-browser agents. Hub-origin PUT to a content path is `307`/`308` or JSON naming the content origin (not a 302 that becomes GET).

### Drift

- R18. One TypeScript module exports header names, 401/405 copy, content `llms.txt` body, and hub SOP lines. `config.ts` keeps the header constants. Skill templates contain the same literals. `skill-render.spec.ts` imports the TS constants and asserts they appear in the rendered skill.
- R19. Goldens freeze hub `llms.txt`, content `llms.txt`, and `helpBody` SOP. A unit test asserts the fragment appears in hub llms, content llms, and help. Content golden must not mention `/v1`, `/auth.md`, `/tokens`, or `/connect`.
- R20. `write_password` on `/v1` create/PATCH goes into `openapi/v1.json`. Guest PUT is not a `/v1` path. Any new `ApiError` code still has to appear in OpenAPI because openapi-drift scans all of `src/`. Prefer reusing `password_required` for wrong write secret, with a message that names the write header. `405` for unset may reuse `method_not_allowed`.

### Hub UI

- R21. Stage primary: URL, expiration, Who can write (instance door), Publish. Closed disclosure "Link access" holds share password and write password. Open the disclosure when either field is non-empty. Overwrite ("Write into it") must still send write password if staged.
- R22. Write policy stays visible. Note that it does not grant or deny the write-password door.
- R23. Catalog password slot is one glyph at **36px minimum**. View-password hash set and write-password hash unset: existing padlock. Write-password hash set (alone or with a view password): the diagonal lockup (lock NW, filled pencil SE). Write-only shows that lockup, not a lone pencil and not a padlock beside a pencil. Neither hash: no password mark. One Link access dialog from that control (same dialog, two fields). Each secret is `unchanged | replace | remove`. Empty box does not clear the other secret. Do not place padlock and pencil as horizontal siblings. Do not fuse a pencil onto the lock body. Do not ship a 16px/19px lockup. Do not use a `write password` / `shared write` / `writable` text chip as the scan. Optional existing `password` chip may stay for the view door or drop once the padlock is enough. Copy in the dialog: a file write password replaces that file only. A site write password is full control of served bytes, including replacing `index.html`. Instance tokens still follow write policy. Write password is for someone not on this host. Non-creators do not get the write-password fields.
- R24. Gate page stays a share-password unlock. Do not accept the write secret in the form. DESIGN.md: a lock describes a share password; the NW-lock / SE-pencil lockup is the write-password mark; both render at ≥36px. CONCEPTS.md gains Write Password. STRATEGY.md "shared writes happen through in-place replacement under write policy" needs a clause for the write-password door. Optional third catalog mark (org-write exception vs instance default) is also ≥36px. People construction is overlapping (front + peeking). On = those people (org can write). Off = the same people plus an X badge; badge circle stroke is thinner than the people (~1.15 vs 1.75) so the X stays open. No lone person silhouette. No pencil on the people mark. Thin slash through the group is out. Password mark and people mark may appear on the same row; each lives in a matching hairline tile so the lock is not optically a smaller sibling of the heads.

### Skill, help, verify

- R25. Instance skill: scenario "outside agent updates this URL." Creator sets write password, human sends public URL plus write password, outside agent `GET {content_origin}/llms.txt` (or reads the guest section of hub `/llms.txt` on single-origin) and PUT with `X-Energon-Write-Password`. Do not mint them a token.
- R26. `helpBody` and hub `llms.txt` describe both doors. `auth.md` (hub only): a write password is an object-scoped shared secret for public-URL PUT, not an account token, not Access.
- R27. verify-energon: new recipe plus updates to `share-password.md` and hub-catalog handles this change moves (`#stage-password` disclosure, dialog title, both fields, padlock only on view-password-only rows, diagonal lockup on any write-password row including write-only, never padlock beside pencil, icons ≥36px, org-write exception is overlapping people or people+X, matching hairline tiles when both families appear). Do not require two Hosts unless `bin/launch` / `bin/doctor` change. Proofs: guest PUT without `Authorization`; guest PUT of a new site path (`201`); guest DELETE of a site path (`200` JSON); last-path DELETE leaves `GET /{handle}/s/{slug}/` at `200`; directory URL DELETE is `405`; guest DELETE of a loose file is `405`; empty loose PUT then GET is `200` length 0 at the same public URL and the same `Content-Type`; read header cannot PUT or DELETE; cookie cannot PUT or DELETE; identical phrases still header-bound; `write_policy=owner` guest PUT succeeds; creator-only set; clear write password then PUT 405; 405 when unset (no write header named); content vs hub `/llms.txt` when origins differ, guest section present when they do not; content-host `/v1/help` is 404 naming `/llms.txt` when origins differ; catalog still shows the object after guest PUT; Last writer is still the account; via copy is "Updated via shared write"; write-only row shows the lockup and no sibling padlock.

### Success Criteria

- An outside agent given a site write password can add, replace, or delete paths under that slug without a token, and cannot delete the site.
- An outside agent given a file write password can replace that file (including empty) and cannot delete it. The public URL still resolves.
- A viewer given only the share password cannot PUT or DELETE.
- A human who only unlocks the gate cannot cause a PUT or DELETE via the cookie.
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

Additive `write_password_hash` on `sites` and `loose_files`. Additive `written_via` rather than stuffing a sentinel into `last_written_by`. New migration, `ensureColumns`, `src/schema.sql`. Distinct hash prefix from share passwords. Clearing the write password is revocation and must be visible to in-flight guest claims.

## Out of scope

- Browser upload or editor on the unlocked page
- Named invites, guest API tokens
- Zip import via write password
- Guest `DELETE` of a loose file or of a whole site
- New site write-claim table (keep today's R2 snapshot + D1 rollback)
- Per-site guest byte ceiling beyond the platform cap
- Two-origin verify-energon unless `bin/launch` / `bin/doctor` change
- Injecting protocol into file bytes
- Per-person revoke
- Fixing the pre-existing concurrent gate limiter
- Guest write-event audit table (later; STRATEGY revision-share instrumentation)
- CORS-enabled browser PUT
- Public `Allow: PUT` on cacheable GET
- `skill:render` importing Worker TypeScript

## Verification (when implementing)

- `test:unit` goldens, fragment drift, skill-render, gate/password, openapi-drift
- `test/api.spec.ts` status matrix, new site path `201`, site path DELETE `200` JSON, last-path DELETE keeps site `200`, directory DELETE `405`, loose-file DELETE is `405`, empty loose PUT then GET `200` length 0, file-count ceiling `400 too_many_files`, header-bound identical phrases, cookie refused for PUT and DELETE, owner-policy guest PUT, creator-only set including overwrite, duplicate drops write hash, method-first `405` before secret check
- `test/files.spec.ts` guest PUT rejects rename and set-password headers; guest loose-file PUT keeps stored `Content-Type`
- `test/site-integrity.spec.ts` hash-in-predicate vs clear mid-flight
- `test/api.purge-claim.spec.ts` expired/purge-claimed guest PUT and path DELETE
- `test/routes.spec.ts` Host-branched `/llms.txt`, content-host `/auth.md` and `/v1/help` 404 naming `/llms.txt`, hub-origin PUT/DELETE is `307`/`308` or JSON (not 302→GET)
- `test/pages.spec.ts` disclosure, dialog unchanged/replace/remove, padlock only when view password is set and write password is not, lockup whenever write password is set, never padlock beside pencil, icons ≥36px, Last writer stays the account, via copy, site write-password copy names homepage control
- `check:ui`
- verify-energon recipe updates listed in R27

## Adversarial review (2026-09-05)

Two four-model interrogates. Consensus that would have shipped bugs is folded above. A third pass is not required unless the contract changes again.

### Pass 1 — original overwrite-only slice

**Act on (folded).** Guest PUT is not `putLooseFromRequest`. `WriteAuthority` not a fake `Actor`. Bytes-only. Header-bound even when phrases match. Content `/llms.txt` is a Host branch of an existing public route, not a new 404 exception. Access is not why `/v1` is closed. Creator-only set. Hash in the claim predicate. Split rate-limit scopes. Do not put a sentinel in `last_written_by`. 405 when unset. No cacheable `Allow: PUT`. Purge on write-password PATCH. No CORS for PUT. Form does not take the write secret. Dialog omit vs clear per field. skill-render asserts constants. Single-origin `/llms.txt` rule. OpenAPI still lists every `ApiError` code. Verify map handles this change moves.

**Product override after pass 1.** Reviewers wanted guest site PUT to 404 on missing paths. The product call is that a site write password is write into that folder: add, replace, and delete paths, with the 200-file and byte caps. Unbounded trees stay out.

**Dismissed.** Concurrent gate burst rewrite (pre-existing sequential limiter, not this feature). PBKDF2 for write hashes (distinct prefix is the slice; share passwords already SHA-256). Full write-event table (instrument later). Public HEAD as a vehicle for `Allow: PUT` (HEAD is unscoped; do not add it to advertise write).

### Pass 2 — file-vs-site add/delete and URL stability

Run after the product override. Scope delta only. Not a re-review of pass-1 protocol.

**Act on (folded).** Cookie/gate never authorize PUT or DELETE. Method-first `405` before the secret check so illegal DELETE is not a 401 writability oracle. Hub-origin PUT/DELETE to a content path is `307`/`308` or JSON, not today's method-blind `302` (which becomes GET). Loose-file PUT compares the filename segment to `urlFilename(row.filename)` and never 302s. Directory URL is empty normalized path (`…/s/{slug}` and `…/s/{slug}/`) → `405`. Nested `foo/` is the file `foo` after `normalizeRelPath`, not prefix-delete. Last-path DELETE keeps the `sites` row; site root stays `200`. DELETE success is `200` JSON `{ deleted: true, path }`, not 204. New path at the file ceiling is `400 too_many_files`, not 413; replace and DELETE still work at 200 files. New `site_files` rows inherit the site's current account writer; never a guest sentinel in `last_written_by`. Authorize guest PUT/DELETE before `protectContent`. Guest error bodies omit `hub`. `releaseStorage` on empty/shrink PUT and path DELETE. Creator-only also on `overwrite: true`. Hub copy: a site write password is full content control, including the homepage. Verify proofs cover last-path DELETE, directory DELETE `405`, cookie cannot DELETE, and empty PUT GET `200` length 0.

**Rationale restated.** Guest `DELETE` of the site or of a loose file stays out because the minted identity (`/{handle}/f/{id}/{filename}` or `/{handle}/s/{slug}/`) cannot be reconstituted. Path DELETE may 404 that path; that is fine because the owner can PUT the same path back. Empty overwrite of a loose file is allowed and leaves the URL.

**Dismissed.** New site write-claim table (pre-existing site PUT race; keep R2 snapshot + D1 rollback). Per-site guest byte ceiling beyond the platform cap (accept explicitly). Two-origin verify-energon unless `bin/launch` / `bin/doctor` change. Concurrent COUNT race at 200 files (best-effort, same as zip). PBKDF2 (still out).

**Session-settled after pass 2.** Last writer stays the last account; never `guest`. Via copy is "Updated via shared write". Column name is `written_via`. Catalog password slot is one mark at ≥36px: padlock for view-password-only; diagonal lockup (lock NW, filled pencil SE) whenever a write password is set (write-only or both). Never lock beside pencil. Never a pencil fused onto the lock body. No `shared write` chip. Org-write exception, if shown, is overlapping people (front + peeking) at ≥36px: on = people (org can write), off = people + X badge. Badge circle stroke is thinner than the people (~1.15 vs 1.75). Two equal rings over a connected double-hump are out (reads as a face). Instance default picks which of those two is the exception. Do not use a lone person silhouette. Do not put a pencil on the people mark. Thin slash through the group is out. When both families appear on a row, each mark sits in a matching hairline tile. Content-host `/v1/help` is 404 JSON that names `GET /llms.txt` on this host. Guest loose-file PUT reuses the stored `Content-Type`.

## Open questions

Tile stroke is hairline (fg 22%). Inset around the 36px glyph is still open: 8px (54px tile) vs 12px (62px tile). 4px is cramped. Do not shrink the glyph to make padding.
