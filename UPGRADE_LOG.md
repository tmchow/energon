# Dependency Upgrade Log

**Date:** 2026-09-03
**Project:** energon
**Language:** Node.js / TypeScript
**Manifest:** `package.json`

---

## Summary

| Metric | Count |
| --- | ---: |
| **Total direct dependencies and overrides** | 13 |
| **Updated** | 8 |
| **Already current** | 4 |
| **Skipped** | 1 |
| **Failed (rolled back)** | 0 |
| **Requires attention** | 2 |

## Updates

### fflate: 0.8.2 → 0.8.3

**Changelog:** [GitHub release](https://github.com/101arrowz/fflate/releases/tag/v0.8.3)

**Breaking changes:** None found.

**Notable changes:** ZIP64 parsing, cross-realm `Uint8Array`, stream memory release, synchronous flush support, and TypeScript 5.7+ typing fixes.

**Migration:** Raised the manifest range to `^0.8.3`; the lockfile already resolved 0.8.3.

**Tests:** ✓ `npm test` (168 unit + 109 worker tests)

### oxlint: 1.80.0 → 1.81.0

**Changelog:** [GitHub release](https://github.com/oxc-project/oxc/releases/tag/apps_v1.81.0)

**Breaking changes:** None found. Node and native-platform requirements are unchanged.

**Notable changes:** Rule correctness fixes and safer autofixes. Energon's enabled `correctness` and `complexity` categories produced the same ten pre-existing complexity warnings before and after the update.

**Migration:** Package and lockfile update only.

**Tests:** ✓ `npm test` (168 unit + 109 worker tests)

### esbuild override: 0.28.1 → 0.28.2

**Changelog:** [GitHub release](https://github.com/evanw/esbuild/releases/tag/v0.28.2)

**Breaking changes:** None found.

**Notable changes:** Fixes incorrect tree shaking/minification, top-level-await output, a JavaScript API deadlock, unsafe input overwrite behavior, and CSS output defects. It also adds a warning for syntax rejected by TypeScript 7.

**Migration:** Updated the exact override and refreshed the lockfile/native package.

**Tests:** ✓ `npm test` (168 unit + 109 worker tests)

### ws override: 8.21.0 → 8.21.3

**Changelog:** [8.21.1](https://github.com/websockets/ws/releases/tag/8.21.1), [8.21.2](https://github.com/websockets/ws/releases/tag/8.21.2), [8.21.3](https://github.com/websockets/ws/releases/tag/8.21.3)

**Breaking changes:** None found. Node remains `>=10.0.0`.

**Notable changes:** Counts empty fragments toward resource limits, lowers `maxBufferedChunks` and `maxFragments` defaults, and fixes `permessage-deflate` parameter validation.

**Migration:** Updated the exact override and refreshed the lockfile.

**Tests:** ✓ `npm test` (168 unit + 109 worker tests)

### typescript: 5.9.3 → 7.0.2

**Migration:** [Official TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)

**Breaking changes:** TypeScript 7 uses the Go-native compiler, removes deprecated compiler options and syntax, has no stable compiler API, and no longer ships `tsserver`. The Node floor rises to 16.20.

**Project impact:** Energon imports no compiler API, invokes no `tsserver`, and its explicit `ES2022`/`bundler` configs use none of the removed options. No config edit was needed.

**Tests:** ✓ `wrangler types`, both `tsc` projects, `oxlint`, and `npm test` (168 unit + 109 worker tests) on Node 24.17.0; CI uses Node 22.

### @cloudflare/vitest-pool-workers: 0.12.21 → @cloudflare/vitest-plugin 1.1.3

**Migration:** [Cloudflare's official package migration](https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-to-vitest-plugin/) and [Vitest 3→4 guide](https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-from-vitest-3-to-vitest-4/)

**Breaking changes:** The old `defineWorkersConfig`/`./config` API and `poolOptions` shape are removed. Ambient types move to the `/types` export, and storage isolation changes from per-test to per-file.

**Migration applied:** Replaced the package with Cloudflare's stable successor, moved Workers options into the `cloudflareTest` Vite plugin, and updated the TypeScript types path. `env` and `SELF` remain supported (deprecated) and were intentionally not churned.

**Attempts:**

1. `@cloudflare/vitest-pool-workers` 0.22.0 could not start against Energon's 2026-08-26 compatibility date because its bundled runtime stopped at 2026-08-22.
2. The successor plugin started, but its stricter CommonJS loader exposed `xss` helpers only on the callable default export.
3. Accessed those documented CommonJS properties through a typed bridge; all tests passed.

**Tests:** ✓ `wrangler types`, both `tsc` projects, `oxlint`, and `npm test` (168 unit + 109 worker tests)

### vitest: 3.2.7 → 4.1.11

**Migration:** [Vitest 4 migration guide](https://vitest.dev/guide/migration)

**Breaking changes:** Requires Vite 6+ and Node 20+; removes `poolOptions`, changes mocking and coverage behavior, replaces the pool implementation, and removes deprecated reporter/internal APIs.

**Project impact:** Energon uses no affected coverage, reporter, browser, workspace, or mock APIs. The Cloudflare plugin migration owns the required pool configuration change.

**Tests:** ✓ Included in the Cloudflare compatibility-unit validation above.

### sharp override: 0.35.2 → 0.35.4

**Changelog:** [GitHub release](https://github.com/lovell/sharp/releases/tag/v0.35.4)

**Breaking changes:** None found. Node remains `>=20.9.0`, the native platform matrix is unchanged, and optional native packages remain required.

**Notable changes:** Tighter validation of invalid/infinite image parameters, improved native-library resolution and stream completion, more precise buffer types, and libvips 8.18.6.

**Migration:** Updated the exact override. Miniflare pins 0.35.2, but isolated native loading and Energon's full suite passed with 0.35.4; Energon has no Images binding.

**Tests:** ✓ `npm test` (168 unit + 109 worker tests)

## Already Current

- `marked` 18.0.11
- `mermaid` 11.17.2
- `xss` 1.0.15
- `wrangler` 4.128.0

## Skipped

### undici override: 7.29.0 → 8.10.1

**Reason:** Miniflare pins 7.29.0 exactly and Cloudflare has not adopted Undici 8. The major release requires Node `>=22.19.0`, replaces legacy dispatcher callbacks, enables HTTP/2 negotiation by default, and changes Blob/File validation.

**Evidence:** Energon's suite passed in a trial with 8.10.1, but does not cover every Miniflare proxy/interceptor/global-fetch/H2 tooling path. A direct legacy-dispatcher probe failed without `Dispatcher1Wrapper`.

**Action:** Restored the upstream-supported 7.29.0 pin. Revisit after Miniflare adopts Undici 8, or in a dedicated compatibility change with an explicit Node floor and focused tooling coverage. See the [Undici 7→8 guide](https://github.com/nodejs/undici/blob/v8.10.1/docs/docs/best-practices/migrating-from-v7-to-v8.md).

## Failed Updates (Rolled Back)

None.

## Requires Attention

### Undici 8 override support boundary

Cloudflare's current Miniflare dependency pins Undici 7.29.0 exactly and has not declared Undici 8 support. A dedicated future migration needs explicit coverage for dispatcher wrappers, global fetch, proxies/interceptors, uploads, and HTTP/2 behavior.

### Vitest 5 support boundary

Vitest 5.0.0 became the registry latest after this update was validated. `@cloudflare/vitest-plugin` 1.1.3 is still the latest Cloudflare plugin and declares `vitest`, `@vitest/runner`, and `@vitest/snapshot` peers at `^4.1.0`, so Energon remains on the newest supported Vitest 4 release. Revisit Vitest 5 after Cloudflare publishes compatible peer ranges.

## Security Notes

- Baseline `npm audit`: 0 vulnerabilities across 313 installed packages.
- Final `npm audit`: 0 vulnerabilities across 325 installed packages.
- `npm outdated --json`: reports Vitest 5.0.0; Cloudflare's latest test plugin supports Vitest 4.x.

## Post-Upgrade Checklist

- [x] Worker types regenerated
- [x] Both TypeScript projects pass
- [x] Lint passes with the same ten pre-existing complexity warnings
- [x] 168 unit tests pass
- [x] 109 Worker tests pass
- [x] Security audit passes with no vulnerabilities
- [x] Registry check leaves only the documented Vitest 5 compatibility boundary; the pinned Undici exception is also documented

## Commands Used

```bash
npm outdated --json
npm install
npx wrangler types
npm run typecheck
npm run lint
npm test
npm audit
```
