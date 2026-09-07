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
An instance-issued credential that authorizes an agent to use Energon's authenticated API as its owning account.

### Token Prefix
The instance-specific marker at the beginning of an API Token that identifies which token format the instance accepts. It is part of the instance identity and must remain consistent when tokens are minted, authenticated, masked, or described to agents.

### Token Expiry
The lifetime a human chooses when minting an API Token, after which authentication rejects it. An expired token is kept in the account's token list as a record and can still be revoked, but it cannot be renewed; like every API Token it has no recoverable secret. Token expiry is governed by its own instance policy, separate from content retention.

### Write Password
A per-object shared secret that lets someone outside the host replace bytes at a published URL without an API Token, Access, or `/connect`. It is independent of the share password. The write header authorizes PUT (and site-path DELETE). It is not an account and is not recorded as Last writer.

### Share Password
A per-object shared secret that gates reading a published URL. Browsers use the gate form and cookie. Agents send the share-password header. The cookie never authorizes PUT or DELETE.

## Instance Identity

### Instance Identity
The runtime configuration that tells agents which Energon instance they are using and how to interact with it. It includes the instance origin, skill and marketplace coordinates, token environment variable, and Token Prefix.

An Instance Identity is resolved from deployment configuration with project defaults as fallbacks. Authentication and credential presentation use the same identity so an instance cannot advertise or issue credentials in a format it will reject.

## Relationships

- A Site contains Site files; a Loose file is published outside any Site.
- An Instance Identity defines the Token Prefix used by an API Token.
- An API Token authenticates against the Instance Identity that issued it.
- Purge claims and Write claims make competing content mutations resolve before storage changes begin.
- A Share Password gates reading a published URL. A Write Password authorizes guest PUT (and site-path DELETE) on that same object without an account.

## Schema lifecycle

### Schema bootstrap
The startup process that makes the database structure available to the application, including creating absent tables and completing supported additive upgrades.

### Legacy schema upgrade
An additive schema bootstrap path that brings an earlier supported database shape forward without rebuilding its existing tables or changing their persisted identity relationships.

### Index phase
The final schema-bootstrap stage that creates indexes after every table and column required by those indexes exists.
