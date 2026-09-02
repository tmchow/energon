# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Published content

### Site
A named collection of public files addressed through one stable site URL.

### Site file
A single path within a Site, with content bytes and catalog metadata that must remain consistent across the storage and catalog layers.

### Site mutation
An operation that changes one or more Site files or the Site itself. A mutation is complete only when its storage and catalog changes agree; a failed mutation must restore the prior state or report an explicit recovery failure.
