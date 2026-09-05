# Energon UI

The application uses Svelte 5.57.0 and the Claude Design handoff supplied in `Energon Design System.zip`. The existing Cloudflare Worker renders the pages and serves their compiled browser assets. Routing, Access, account APIs, D1, R2, and the separate content hostname remain owned by the Worker.

The marketing site is maintained separately in the private `tmchow/energon-marketing` repository. This application does not build it.

## Sources

| Path | Purpose |
| --- | --- |
| `src/ui/design/` | Verbatim handoff CSS tokens, component styles, and SVG assets |
| `docs/design/DESIGN_SYSTEM.md` | Original visual and content guide from the handoff |
| `src/ui/styles.css` | Application layouts and accessibility adaptations layered over the supplied CSS |
| `src/ui/components/` | Shared Svelte controls, layout, tables, feedback, and brand motifs |
| `src/ui/pages/` | Hub, Tokens, Setup, Connect, About, Stats, Gate, and Markdown |
| `src/ui/types.ts`, `src/page-data.ts` | Typed page payloads; no credentials are embedded in token-page data |
| `src/ui-render.ts` | Server markup, escaped hydration JSON, and hashed browser asset reference |
| `scripts/build-ui.mjs` | Svelte compiler and esbuild pipeline |
| `src/ui/specimen/` | Local component examples, excluded from the application entry point |

Use Svelte 5 runes (`$props`, `$state`, `$derived`) for new UI code. Form controls expose bindable values; components accepting content use snippets. Keep API calls in the owning page or `uploads.ts`, and use the existing Worker helpers for shared domain rules such as slug numbering and byte formatting.

The hub owns upload staging, explicit collision confirmation, pagination, and catalog dialogs. Tokens reveals a newly minted secret in browser state once; reloading fetches only the catalog's redacted token records. Connect retains the human approval boundary. Password gates use ordinary HTML forms, and Markdown rendering retains the existing sanitizer, CSP, Mermaid loader, raw responses, and downloads.

Interactive pages initially render dates in UTC so server and client hydration agree, then switch to the browser's local timezone. Public Markdown has no application JavaScript and keeps UTC. All `time` elements retain the exact ISO timestamp.

## Build and check

```bash
npm install
npm run dev
npm run check:ui
npm run specimen:ui
python3 -m http.server 18788 --bind 127.0.0.1 --directory .context/ui-specimen
```

The last two commands build and serve the local specimen at `http://127.0.0.1:18788`. It covers controls, dialogs, tables, motion, and the optional light theme without making application API calls.

Wrangler's custom build and both Vitest configurations run `build:ui`. Generated server code and CSS go to `src/generated/`; content-hashed browser JavaScript goes to `public/static/ui/`. Both are ignored by Git. Ambient declarations cover the generated server entry and asset manifest so typecheck also works before the first build on a fresh checkout. `/static/ui/*` passes through the Worker to enforce the hostname boundary before serving assets. Public gates and Markdown do not load the application bundle.

`npm run typecheck` checks both the Worker and Svelte UI. The isolated `tooling/svelte` npm workspace supplies TypeScript 6 for `svelte-check`, whose current peer range does not yet support the Worker's TypeScript 7. This preserves the root compiler version and avoids forced peer dependencies.

The handoff CSS contains a glob inside its opening comment that prematurely closes the comment. The build repairs that comment in memory; the source stays byte-for-byte identical. Application overrides also make conduit units travel the full line and retain desktop access to the More menu. Respect `prefers-reduced-motion` and keep the supplied cube geometry.

## Verification

Page contracts live in `test/pages.spec.ts`; upload staging cases live in `src/ui/uploads.spec.ts` (checked with the UI DOM types). Worker/API suites cover persistence, token policy, connections, passwords, content separation, and sanitization. The local browser/API recipes are in `.cursor/skills/verify-energon/`.

Use a separate verification port and persistence directory. Check desktop and mobile views, actual public bytes after mutations, exact-name confirmations, one-time token reveal and revocation, search/pagination, and both folder and ZIP publishing. The reference fidelity pass records matching page bounds and intentional mobile/accessibility adaptations. Its measurements, implementation plan, and validation record are in `docs/plans/2026-09-04-svelte-design-system.md`.
