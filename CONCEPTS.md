# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Authentication

### API Token
An instance-issued credential that authorizes an agent to use Energon's authenticated API as its owning account.

### Token Prefix
The instance-specific marker at the beginning of an API Token that identifies which token format the instance accepts. It is part of the instance identity and must remain consistent when tokens are minted, authenticated, masked, or described to agents.

## Instance Identity

### Instance Identity
The runtime configuration that tells agents which Energon instance they are using and how to interact with it. It includes the instance origin, skill and marketplace coordinates, token environment variable, and Token Prefix.

An Instance Identity is resolved from deployment configuration with project defaults as fallbacks. Authentication and credential presentation use the same identity so an instance cannot advertise or issue credentials in a format it will reject.

## Relationships

- An Instance Identity defines the Token Prefix used by an API Token.
- An API Token authenticates against the Instance Identity that issued it.

## Schema lifecycle

### Schema bootstrap
The startup process that makes the database structure available to the application, including creating absent tables and completing supported additive upgrades.

### Legacy schema upgrade
An additive schema bootstrap path that brings an earlier supported database shape forward without rebuilding its existing tables or changing their persisted identity relationships.

### Index phase
The final schema-bootstrap stage that creates indexes after every table and column required by those indexes exists.
