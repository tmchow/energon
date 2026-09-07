# Designing Energon

Proposed design guidance for the Energon application and its public reading surfaces.

Energon gives documents, prototypes, and working files a stable link. Agents publish, read, reference, and revise ordinary files; people open the result or upload directly. Design should make that loop clear and make the consequences of each action visible.

The visual idea is a dark instrument lit from within. Violet charge marks activity and emphasis. The cube holds the work; conduits show its movement between people and agents. Most of the interface stays quiet so the work and the next action remain easy to find.

## Where this guide applies

Use this file when adding or changing the Hub, Tokens, Setup, Connect, About, Stats, password gate, or Markdown viewer. It governs Energon's interface, including the wrapper around published Markdown. It does not prescribe the design of uploaded sites or rewrite the author's document content.

This is design guidance, not the publishing SOP or build manual. Follow [AGENTS.md](AGENTS.md) for repository changes, [STRATEGY.md](STRATEGY.md) for positioning and product boundaries, and [docs/design/README.md](docs/design/README.md) for implementation and verification.

## Start from the person's task

Before choosing components, identify what someone came to do, what they need to know before acting, and what result confirms completion. Keep those three things together.

| Surface | What should lead | What must remain available |
| --- | --- | --- |
| Hub | Choose work, inspect staging, publish | Existing catalog, search, public URL, expiry, write policy, item actions |
| Tokens | Mint a token and understand its authority | One-time secret reveal, redacted catalog, expiry, revoke consequence |
| Setup | A usable instruction for connecting an agent | Instance-specific details and the next step |
| Connect | Identify the requesting agent and enter its code | Expiry, scope, explicit approve and deny actions |
| About | A concrete publishing or reference workflow | What people and agents can do with the same work |
| Stats | Storage and usage with clear units | Scope, totals, and comparable per-person values |
| Password gate | Enter the shared password | The result of a failed attempt and guidance from the sender |
| Markdown | Read the author's document | Raw access, download, readable code and tables |

Keep the primary task visible without an introductory feature tour. Put policy explanations beside the fields they qualify. Separate unrelated jobs rather than making every screen use the same arrangement of cards.

When requirements conflict, preserve product behavior and accurate consequences first, usable reading and interaction second, and visual fidelity third. Improve an inaccessible layout without changing its brand or silently removing a capability.

## Use the system that exists

Read the closest implemented page and the shared component before inventing a new treatment.

| Source | Use it for |
| --- | --- |
| [Design tokens](src/ui/design/tokens/) | Semantic colors, fonts, type roles, spacing, measures, effects |
| [Component CSS](src/ui/design/components/components.css) | Existing `.en-*` visual treatments and responsive rules |
| [Svelte components](src/ui/components/) | Controls, content grouping, dialogs, feedback, and brand motifs |
| [Application styles](src/ui/styles.css) | Page layouts and deliberate responsive/accessibility adaptations |
| [Implemented pages](src/ui/pages/) | Examples of how these pieces serve actual tasks |
| [Component specimen](src/ui/specimen/Specimen.svelte) | Examples of component variants and states |
| [Original handoff](docs/design/DESIGN_SYSTEM.md) | Visual rationale and the supplied design direction |

The original handoff is preserved as reference. Its React examples, `ui_kits/` paths, and legacy HTML filenames are historical. Use the current Svelte sources and design README for integration. Do not recreate the handoff's runtime or restore its superseded mobile layouts.

Reuse component props and snippets. Read their definitions for supported options; do not guess a variant or a class name. Keep new page layout rules in the application layer. Treat the supplied `src/ui/design/` assets as the preserved foundation, not a place for routine page overrides. Do not edit generated bundles.

There is no public, standalone Energon stylesheet contract in this proposal. Repository paths are local references, not URLs to emit into a hosted page.

## Visual decisions

### Color and charge

Use semantic tokens in new styles. The values below identify the dark palette; they are not a second set of constants to copy into components.

| Role | Token | Dark reference |
| --- | --- | --- |
| Canvas | `--bg-canvas` | `#070814` |
| Surface | `--bg-surface` | `#0d1220` |
| Translucent card | `--bg-surface-a` | Surface at 86% opacity |
| Primary text | `--fg-1` | `#ece8f8` |
| Supporting text | `--fg-3` | `#9a93b3` |
| Violet accent | `--accent` | `#b08cff` |
| Lit highlight | `--fg-hot` | `#f3ecff` |
| Quiet boundary | `--border-1` | `#26233c` |

Keep the supplied canvas wash. Cards and controls use the established surfaces, hairlines, and shadows. Do not add gradient text, photographic backgrounds, glass blur, or unrelated decorative effects.

Charge belongs on the cube, primary action, focal drop zone, URL field, selected controls, progress indicators, focus, and conduit units. Use at most one charged card per page. Do not glow body copy or every panel. App actions use their existing interaction states; do not add breathing animations to buttons.

Green indicates a successful result, amber a warning or expiry condition, and rose an error or destructive confirmation. Existing destructive icon buttons use amber. Preserve that distinction and always provide a text label or other non-color cue. A lock describes a share password, not an individual access-control list. The lockup (lock northwest, filled pencil southeast) describes a write password.

The application ships dark. Light tokens and specimen examples exist for exploration; their presence is not a reason to add a theme switch or claim a production light theme is complete.

### Typography and geometry

Use IBM Plex Sans for readable prose, headings, and controls. Use IBM Plex Mono for machine-shaped content such as URLs, tokens, slugs, emails, and timestamps, plus the system's compact metadata, kickers, and table headers. Do not use Michroma in the application.

Prefer component type roles and the `--type-*` tokens. Body text is 15px with 1.5 leading; UI text is 13.5px. Small metadata roles are for short supporting content, not paragraphs or important warnings. Keep comparable values in the same type role and use tabular numerals for aligned numbers.

Use the spacing tokens by their actual values: `--space-1` is 4px, `--space-2` 8px, `--space-4` 16px, `--space-6` 24px, and `--space-7` 32px. The suffix is not a universal multiplier. Preserve component-specific padding rather than rounding it to a new scale.

The app page measure is `--measure-page` (74rem), Markdown `--measure-md` (46rem), and introductory copy `--measure-lede` (36rem). Controls use `--radius-1` (4px), cards and dialogs `--radius-2` (8px), and sheets `--radius-3` (12px). Pills are for the existing bar treatment, not a default shape for everything.

Align headings, cards, and footer to the same page edges. Group labels with their fields and actions with the content they affect. Use larger gaps between jobs than within a job. Fix grouping and available width before shrinking text.

### Brand assets and movement

Reuse [CubeMark](src/ui/components/CubeMark.svelte) and the [supplied logo](src/ui/design/assets/logo.svg). Preserve the cube geometry. Use `Conduit`, `Unit`, and `Flow` when showing movement or a relationship between actors. Do not add a flow diagram simply to fill empty space.

Use [the existing icons](src/ui/icons.ts). Add a missing icon in the same 24px grid, 1.75 stroke, round-cap grammar only when the action needs it. Keep icon buttons named. Do not introduce another icon family or use emoji as product icons.

Retain the existing 120ms hover, 200ms state, and 350ms layout timings. Cube breathing and conduit travel are specific brand motifs, not a general license for animated decoration. Honor reduced motion, keep static states understandable, and never delay access to content for an entrance animation.

## Choose components by purpose

| Need | Reuse | Design constraint |
| --- | --- | --- |
| Page identity | `AppHeader`, `PageTitle`, `AppFooter` | One descriptive h1; preserve the correct app or public shell |
| A distinct task or collection | `Card` | Group related content; avoid cards inside cards solely for decoration |
| Main or supporting action | `Button`, `IconButton` | Use primary sparingly; label the operation; keep Cancel distinct |
| An editable value | `Field`, `Input`, `Select`, `SegmentedControl` | Visible label, meaningful state, consequence beside the input |
| Copyable or sensitive output | `UrlField`, `CopyRow`, `CopyBlock`, `TokenReveal` | Make copy and reveal behavior real; preserve exact values |
| Catalog and usage | `Table`, `Badge`, `CatalogScan`, `Metric`, `ProgressBar` | Unboxed 28px access marks; row action glyphs are 32px so their ink matches those marks. Hover names the mark. Preserve scanning, units, and the meaning of state |
| Feedback and confirmation | `Flash`, `Dialog`, `ConfirmDialog`, `Sheet` | Keep results near the task; explain destructive consequences |
| Upload staging | `DropZone` and the Hub flow | Distinguish selected work from published work |

Extend the nearest shared component when a reusable behavior is missing. A one-page arrangement does not need a new component family. Build new interactions only when the task requires them; the handoff's absence of a control is not a permanent ban on adding a justified capability.

## Content and trustworthy interaction

Write plain, declarative copy. Lead with the consequence, then explain the mechanism if it helps. Use sentence case, concrete verbs, and the existing product vocabulary. The system's CSS may uppercase short kickers or table headers; do not manually uppercase ordinary headings. Keep the established numbered About scenes, not decorative numbering on every page.

| Prefer | Avoid |
| --- | --- |
| Publish; read, reference, or update | Language that reduces agent use to editing |
| Stable link | Permanent link |
| Independent copy | Version control, branch, or revision history |
| Share password | Private workspace or per-person access promises |
| “Nothing is written until you Publish.” | A success state while files are only staged |
| “There is no recycle bin. Type the name to confirm.” | A vague “Are you sure?” for irreversible deletion |

Use no emoji, exclamation marks, invented urgency, or promotional filler in app copy. Buttons name actions: Publish, Mint token, Approve connection, Deny connection, Revoke, Delete, Copy, Open. Busy labels describe current work, such as “Publishing…”. Show errors with enough context to recover; preserve useful input after a failure.

Do not let visual simplification alter these contracts:

- Publishing collisions require an explicit choice before replacing existing work.
- Destructive dialogs retain exact-name confirmation and explain what is lost.
- Minted token secrets are shown once; the token catalog remains redacted.
- Share and write passwords stay visible on Hub Link access so they can be copied after creation. They are sharing secrets, not login passwords. `/v1` GET does not return them.
- Connection approval remains a deliberate human action. Do not prefill or bypass the code step for convenience.
- Read access, write policy, expiry, and share passwords remain distinct concepts. Catalog marks name those doors on hover: View password, Write password, Org can write, Org cannot write. Do not add a Password chip next to the lock. Show expiry in its own column only when a date is set; do not label unlimited work as Never.
- Copy and success feedback describe an operation that actually completed.

Reuse the existing formatting helpers for bytes, counts, and timestamps. Label the population and period behind a metric. Do not turn lifetime counts into an activity trend or infer readership from writes. Bars must encode actual values on a clear basis; preserve exact values alongside them. Tables should have enough width to scan labels and compare numbers without broken words.

## Small screens and accessibility

Recompose the layout before reducing type. Preserve full-width token fields and stacked mint controls on phones. Catalog rows may collapse to name, metadata, and More; every action must remain reachable. Keep More available on desktop too.

Wrap long identifiers or contain their scrolling locally. Never conceal page overflow to hide a layout failure. Keep dialogs within the viewport with reachable actions and scrollable content. Use the 44px touch target minimum on phones.

Use semantic headings, tables, links, buttons, and labeled fields. Preserve visible keyboard focus, dialog focus handling, accessible icon names, and feedback announcements. Check contrast in the rendered state, including muted text and disabled controls; a token name alone does not establish accessibility.

Keep password submission usable as an ordinary HTML form. Preserve the Markdown reader's lightweight public behavior and Raw access. New app interactions must not impose the entire application bundle on reading-only public pages.

## Review the result, then improve the guide

Inspect the rendered screen, not just its source. Check the first viewport, full page, narrow layout, long content, keyboard interaction, and any states changed by the work. Use the local specimen for shared visual variants and the verification workflow linked from the design README for real user paths. Follow AGENTS.md for applicable tests; passing HTML contracts does not prove visual fidelity.

Use these questions during review:

- Is the next action clear, with its consequence nearby?
- Does the screen retain Energon's typography, geometry, and selective charge?
- Can long names, URLs, and real quantities fit without hiding work or controls?
- Are empty, busy, success, error, and destructive states honest and usable?
- Does the same task remain possible with a keyboard, on a phone, and with reduced motion?

For this proposal's first evaluation, use a fixed Hub task: show staged files, an existing-name collision, and a catalog with a long title and URL. Save the inputs and desktop/mobile sizes. Compare a first attempt made with the existing repository guidance against one made with this guide using the same model and inputs. Review task clarity, retained behavior, visual fidelity, and overflow. This comparison is proposed, not yet performed.

Expand to Tokens and public Markdown when the first comparison identifies useful corrections. Keep design decisions here, reusable rendering mechanics in components or CSS, and checkable behavior in tests. Add a rule when a repeated problem warrants it; do not turn this file into a transcript of individual design reviews.
