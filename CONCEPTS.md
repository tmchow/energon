# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Schema lifecycle

### Schema bootstrap
The startup process that makes the database structure available to the application, including creating absent tables and completing supported additive upgrades.

### Legacy schema upgrade
An additive schema bootstrap path that brings an earlier supported database shape forward without rebuilding its existing tables or changing their persisted identity relationships.

### Index phase
The final schema-bootstrap stage that creates indexes after every table and column required by those indexes exists.
