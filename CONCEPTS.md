# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Published content

### Site
A named collection of public files addressed through one stable site URL.

### Site file
A single path within a Site, with content bytes and catalog metadata that must remain consistent across the storage and catalog layers.

### Loose file
A standalone published file addressed independently rather than as a path within a Site.

### Site mutation
An operation that changes one or more Site files or the Site itself. A mutation is complete only when its storage and catalog changes agree; a failed mutation must restore the prior state or report an explicit recovery failure.

### Purge claim
A temporary catalog marker that gives expiration cleanup exclusive permission to remove an expired Site or loose file from storage and the catalog.

### Write claim
A temporary leased catalog marker that gives one loose-file storage mutation exclusive permission to change storage and catalog state.

A fresh Write claim blocks competing replacements and expiration cleanup. An abandoned claim becomes reclaimable after its lease is stale.

If a mutation fails before catalog commit, claim rollback restores the observed timestamp and effective prior writer ownership; reclaiming an abandoned claim normalizes ownership to the file creator instead of reinstalling the stale marker. Successful finalization preserves the committed mutation timestamp.

## Authentication

### API Token
A credential this Energon issues that authorizes an agent to use the authenticated API as its owning account.

### Admin
An account whose email is on `ADMIN_EMAILS` for this Energon. Admins mint Admin Tokens at `/tokens`. Removing the email from the list strips admin from every token they already minted.

### Admin Token
An API Token minted with admin scope by an Admin at `/tokens`. The connect flow never grants that scope. It still acts as the owning account for ordinary `/v1` calls. Admin routes also require the owner to still be on `ADMIN_EMAILS`. Lifetime is at most 7 days and cannot be never. The stored hint uses `admin` after the Token Prefix so a human reading a catalog or audit row can tell it from an account token.

### Token Prefix
The marker at the beginning of an API Token that identifies which token format this Energon accepts. It must stay consistent when tokens are minted, authenticated, masked, or described to agents.

### Token Expiry
The lifetime a human chooses when minting an API Token, after which authentication rejects it. An expired token is kept in the account's token list as a record and can still be revoked, but it cannot be renewed; like every API Token it has no recoverable secret. Token expiry is governed by its own policy on this Energon, separate from content retention.

### Write Password
A per-object shared secret that lets someone outside the host replace bytes at a published URL without an API Token, Access, or `/connect`. It is independent of the share password. The write header authorizes PUT (and site-path DELETE). The write header also unlocks GET. The HTML gate form accepts the write password for reading when a share password is also set. The cookie never authorizes PUT or DELETE. It is not an account and is not recorded as Last writer. The Hub keeps the phrase for the creator so they can copy it again. `/v1` GET returns only whether it is set.

### Share Password
A per-object shared secret that gates reading a published URL. Browsers use the gate form and cookie. Agents send the share-password header. If a write password is also set, that phrase also unlocks the gate form. The share-password header does not accept the write phrase. The cookie never authorizes PUT or DELETE. The Hub keeps the phrase so the signed-in owner can copy it again. `/v1` GET returns only whether it is set. Verification still uses a hash.

## Org, this Energon, and host

### This Energon
The deployed product: one Worker, D1, R2, Access app, and rendered skill. Speak of “this Energon” or “your Energon.” The user-facing CTA is **Want to deploy your own Energon?**

`GET /v1/help` describes this Energon: origins, skill and marketplace coordinates, token environment variable, Token Prefix, retention, token policy, limits. Those values come from deployment configuration with project defaults as fallbacks, so this Energon does not advertise or issue credentials in a format it will reject.

### Org
Everyone who can mint a token on this Energon (Cloudflare Access, with an optional email-domain lock). Not a database entity. Write policy `org` means any of those tokens may write the object. Hub copy says “Anyone in the org.”

### Host
Locative only: the place (this origin, vs someone not on this host). Not the name of the product. Do not say “host identity,” “deploy your own host,” or “deploy your own instance.”

## Relationships

- A Site contains Site files; a Loose file is published outside any Site.
- This Energon’s Token Prefix is the format an API Token from that Energon uses.
- An API Token authenticates against the Energon that issued it.
- Purge claims and Write claims make competing content mutations resolve before storage changes begin.
- A Share Password gates reading a published URL. A Write Password authorizes guest PUT (and site-path DELETE) on that same object without an account.

## Schema lifecycle

### Schema bootstrap
The startup process that makes the database structure available to the application, including creating absent tables and completing supported additive upgrades.

### Legacy schema upgrade
An additive schema bootstrap path that brings an earlier supported database shape forward without rebuilding its existing tables or changing their persisted identity relationships.

### Index phase
The final schema-bootstrap stage that creates indexes after every table and column required by those indexes exists.
