# Energon design system and Svelte migration

Implement the supplied Claude Design handoff with the existing Worker router, Access boundary, account APIs, D1/R2 persistence, and content origin intact. Svelte 5.57.0 is the npm stable release verified on September 4, 2026.

The supplied CSS and assets live unchanged under `src/ui/design/`. Svelte components own page markup and interactive state. The existing esbuild toolchain compiles browser assets and server components; the Worker renders the initial page and the browser hydrates it. Public password forms and Markdown remain usable without application JavaScript. A separate agent owns the marketing site in the private `tmchow/energon-marketing` repository; no marketing site is built here.

## Implementation

- [x] Copy design sources, implement the component inventory, and integrate reproducible builds into development and tests.
- [x] Port Setup, Tokens, Connect, Stats, and About to Svelte using real instance data.
- [x] Port the hub's upload staging, collision confirmation, catalog pagination/filtering, password/write-policy dialogs, duplication, deletion, and WebMCP tools.
- [x] Apply the public gate and Markdown designs without changing sanitization, headers, or raw/download behavior.
- [x] Build a component specimen page for local design verification.
- [x] Update page contracts and local verification recipes to the new UI.
- [x] Run simplification, type/lint/build and relevant unit/Worker tests; drive real local browser and API flows at desktop and mobile sizes.

## Verification requirements

Preserve authentication and content-host isolation, no default overwrite, exact-name destructive confirmations, expiration/write policy defaults, token one-time reveal and revocation, instance-specific identity, Markdown sanitization and Mermaid behavior, pagination, folder/zip/loose-file publishing, and error recovery. Review all eight app/public screens against the handoff. Do not deploy or publish credentials.

Baseline: `npx vitest run test/pages.spec.ts test/routes.spec.ts test/connections.spec.ts` passed (26 tests) before implementation.

## Validation record

Completed September 4, 2026 in the `cory` worktree. No production deployment or remote data changes.

- All 18 copied CSS/SVG source files match the archive byte-for-byte.
- `wrangler types`, `npm run typecheck`, and `npm run lint` pass. Svelte reports zero errors and warnings; lint retains the existing complexity warnings.
- `npm test`: 194 unit tests in 23 files and 123 Worker tests in 11 files pass (317 total).
- The Cloudflare Worker bundles locally: 636.84 KiB before compression, 143.02 KiB gzip. Wrangler retains D1, R2, and static asset bindings.
- New checks cover safe hydration JSON/footer escaping, catalog SSR and asset hostname isolation, folder/ZIP staging, and the eight-digit connection code pattern. The connection-pattern regression was reproduced as a failing test, corrected, and rechecked through browser denial on desktop and mobile.
- Real local D1/R2 browser flows cover loose-file publication, generated share passwords, wrong-password and successful gate submissions, password removal, creator write policy, duplication, exact-name deletion, token one-time reveal and revocation, folder/ZIP publishing, collision alternatives, explicit overwrite with sibling preservation, pagination, search, scope, sorting, copy controls, stats ranking, connection disclosure/denial, and Mermaid rendering.
- All eight screens were checked at measured 390px and 1280px viewports. Mobile menus, single-file folder staging, token mint/revoke, and confirmation dialogs were driven with real controls. No horizontal document overflow. The local specimen covers the optional light theme.
- Simplification ran for the main migration and the final component phase. Applied: reuse 2, quality 2, efficiency 0; skipped 8 low-value or behavior-changing efficiency suggestions. Kept the original upload ordering, collision probes, and notices; kept the specimen on the production build pipeline. No safety or accessibility checks were removed.

Evidence: `/tmp/energon-verify-evidence/svelte-design/` (screenshots, measured layouts, redacted results, and check logs). The verification server used port 18787 and isolated persistence under `/tmp/energon-verify/svelte-design/`; the specimen used port 18788.

Automation limits: Orca viewport settings needed reapplication after navigation, and controls needed scrolling into view before clicks. Screenshots were accepted only after checking the actual viewport width. Orca's keypress command did not deliver a DOM Escape event in this run; cancellation was verified through the Cancel control, while Escape uses the native dialog cancellation behavior. Reduced-motion CSS remains verbatim from the handoff; this run's media-emulation command did not activate that preference.

## Reference fidelity pass

The initial migration verified functionality and applied the supplied tokens, but several page layouts still differed from the React reference. A follow-up pass compared the original prototype and production Svelte markup in Orca at matching viewport sizes and corrected the composition.

- Setup and Tokens use the reference's wide titles; Setup cards stop at 42rem. Tokens uses the original desktop field proportions and token reveal treatment.
- Hub spacing, search height, cube treatment, and status units follow the component source. About uses the original node icons and cube size.
- Stats retains the reference's outer and inner card padding. Connect uses its original paragraph spacing, 48px code field, and action placement.
- The public gate uses the supplied nested card geometry and 35px cube. Markdown uses the document card and path badge, with real R2 size and update metadata.
- Sheets use the dedicated sheet heading, list padding, and ghost Cancel control. Confirmation inputs use the mono style; password notes and flash copy controls use the supplied component styles.

At 1280px, the measured heading and principal card bounds match the reference for Hub, Tokens, Setup, Connect, Stats, and Gate. About diagram and node bounds also match. Hub and Stats populated card bounds match at 390px. The comparison uses the original prototype plus disposable visual fixtures rendered by the production Svelte server/client bundle; real account values, timestamps, policy labels, and Markdown contents remain dynamic.

Deliberate production adaptations remain: Tokens fields stack on narrow screens instead of squeezing the label input; token labels stay visible on mobile; About diagrams wrap to avoid the prototype's horizontal overflow; the public header retains Raw access; More actions stays reachable on desktop; destructive confirmations enforce exact names; connection denial retains the backend's code requirement. Native dialogs provide modal focus and dismissal behavior. These adaptations use the supplied colors, typography, controls, and spacing.

The isolated `svelte-fidelity` run additionally verified browser token mint, authentication, one-time reveal, revocation, the action sheet, code filtering and connection denial, and opening a real protected Markdown file through the redesigned gate. Connection approval was not automated. Typecheck and lint pass; the full suite remains 194 unit + 123 Worker tests. The fidelity simplification pass applied one reuse finding (TokenReveal uses Flash); quality and efficiency reviewers had no findings.

Visual evidence and measured rectangles: `/tmp/energon-fidelity/`. Live browser/API evidence: `/tmp/energon-verify-evidence/svelte-fidelity/`. Some later Orca screenshot attempts timed out when its browser surface was not visible; those attempts are not counted as new screenshots.
