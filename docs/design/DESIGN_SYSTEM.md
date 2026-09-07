# Energon Design System

Energon is **agent-native publishing for documents, prototypes, and working files**. A self-hosted Cloudflare Worker (one Energon per operator) lets agents — Claude Code, Cursor, Codex, curl — publish ordinary files over HTTP and get back a stable link that people can open and other agents can read, reference, or revise. Markdown renders as a document; a ready-to-serve folder becomes a working site. Links are public by default with optional share passwords and expiry. It is not a system of record: code stays in git.

Brand line: **Built for agents. Ready for people.** Friction line: *No repo to create. No deployment pipeline to configure. No new link for every update.*

The brand idea this system pushes: **energon is a unit of energy** — work that is charged once and passed between systems, agents and people along stable conduits. The cube is the vessel; things that are live glow; everything else stays matte.

## Surfaces

- **Hub app** — signed-in web UI: Hub (upload + catalog), Tokens, Setup, Connect (approve an agent's code), About, Stats. `ui_kits/hub/`
- **Public pages** — password gate, rendered Markdown. `ui_kits/hub/` (Gate, Markdown screens)
- **Marketing / getenergon.com** — does not exist in the repo yet; `ui_kits/marketing/` extends the brand to a landing page.

## Sources

- GitHub: https://github.com/tmchow/energon (branch `main`). Read: `STRATEGY.md` (positioning, brand, word choices), `CONCEPTS.md`, `src/chrome.css` (all tokens + product CSS), `src/chrome.ts` (shell, brand mark SVG, Google Fonts link), `src/hub.html` + `src/hub.client.js` (hub, icon set, dialogs, sheet), `src/tokens.html`, `src/setup.ts`, `src/connect.ts` (PR #52, agent connections), `src/about.ts`, `src/stats.ts`, `src/gate.ts`, `src/config.ts` (`formatBytes`, `formatCount`, token prefix). Copied: `src/logo.svg`, `docs/assets/energon-workflows-overview.svg`. Explore the repo for deeper context — the hub templates are the ground truth for app screens.
- Docs: https://docs.getenergon.com — positioning ("Agent-native publishing for documents, prototypes, and working files"), 1-2-3 (Publish → Open or reference → Continue), operate/security model. Marketing copy should follow STRATEGY.md + these docs.
- Prior exploration: https://claude.ai/design/p/070472dd-0488-4b6f-8ba3-cbf89facdbbc — an earlier system on a different basis (light theme, softer corners, extra primitives). This system keeps faithful tokens/components as the default and carries its light theme over as an optional `[data-theme="light"]` scope.

Direction agreed with the owner: hybrid basis (faithful to `chrome.css`, light theme optional); corners softened to 4/8 px; a wide technical display face (Michroma) for marketing; motif = **conduits** (hairlines carrying glowing units) + **charged states** (breathing glow only on what is live/primary).

---

## Content fundamentals

**Voice.** Plain, declarative, slightly dry. Short sentences and fragments. Consequence first, mechanism second. No exclamation marks, no emoji, no marketing adjectives, no apology.
- "Nothing is written until you Publish."
- "There is no recycle bin. Type the name to confirm."
- "The secret is shown once when you mint. The list shows the last four characters."
- "Last write wins."

**Person.** Second person ("you", "your numbers", "your agent"). The product names itself ("Energon only stores a hash"). Other parties are "agents", "the creator", "the person who sent you this link", or handles (Ada, Bob).

**Word choices (STRATEGY.md).** Lead with *rendered documents, working prototypes, stable links*. Say **"publish"** for the operation and **"hand off"** for one outcome. Say **"read, reference, or update"** so agent use isn't reduced to editing. Say **"independent copy"**, never "version control". Avoid "shared workspace", "edit together", "permanent link".

**Casing.** Sentence case everywhere: titles, buttons, labels, nav, table headers (headers are uppercased by CSS). Product nouns are lowercase common words: site, file, slug, token, handle, link. Code is literal: `PUT`, `?raw=1`, `ENERGON_TOKEN`, `X-Energon-Password`, `ee_live_…`.

**Titles.** One sentence with a period: "Publish a document, prototype, or file." "Add Energon to your agent." "Storage and usage." About-page scenes are numbered `01`–`05` with short titles ("Read now. Reference later."). Kickers (mono, uppercase, +0.12em) are 2–4 words: "How much is here".

**Buttons.** Verb or verb + noun: Publish, Choose files, Choose folder, Mint token, Approve connection, Deny connection, Revoke, Delete, Copy, Open, Load more, Cancel. Confirms repeat the verb (dialog "Delete site" → button "Delete"). In-progress: "Publishing…".

**Errors and notes.** State what happened, then what to do or what we did: "That password is wrong." "'lunch-poll' exists. Using 'lunch-poll-2'." "Agents using this key will get 401." Notes under fields explain consequence: "Controls who can update or delete this work, not who can read or reference it."

**Numbers.** `formatBytes`: 48 KB · 1.2 MB · 1.69 GB (2 sig. digits <10, 1 <100, 0 above). Counts with en-US thousands separators. Dates "Sep 4, 9:12 AM"; expiry "Nov 10, 2026 (67 days)"; "Never"; "Expired".

**Emoji:** never. **Unicode as icons:** only "·" as a separator, "→" and "✓" inside terminal demos, "…" for truncated tokens.

---

## Visual foundations

**Mood.** A dark instrument lit from within. Near-black violet ink, hairline violet borders, and a soft purple glow that marks what holds energy. Calm and precise, not neon; high-end through restraint and scale, not decoration.

**Color.** One accent hue — violet, built around the product's `#b08cff` (`--violet-400`) — and violet-tinted neutrals. Dark (default): canvas `--ink-0 #070814`, surface `--ink-2 #0d1220` at 86 % over the wash, text `--ink-9 #ece8f8`, muted `--ink-7 #9a93b3`, borders `--ink-4/5`. `--fg-hot #f3ecff` is the *lit filament* white used for glow text, cube strokes, selected labels and the primary button label. Status: green = result (published, minted), amber = warning / "exists" / expiring **and destructive icon buttons** (matching the product), rose = wrong password / error / danger confirm buttons. Light theme (`[data-theme="light"]`) flips every semantic token; the product ships dark only.

**Background.** Flat ink plus two fixed radial washes (`--canvas-wash`): violet from top-centre, faint indigo top-right. No photography, no patterns, no gradients on surfaces. Marketing may push the wash larger, never add imagery.

**Type.** IBM Plex Sans 400/500/600 for everything readable; IBM Plex Mono 400/500 for everything machine-shaped (slugs, URLs, emails, tokens, timestamps, table headers, kickers, badges, hints). **Michroma (400)** is the system's display face for marketing headlines and the marketing wordmark — wide, geometric, echoing the isometric cube; never used inside the app. App display: Plex Sans 500, −0.03 em, 1.08; titles 550, −0.02 em; body 15/1.5; UI 13.5; labels 12.5; meta 11.5 mono; badges 10.4. Numbers tabular. Fonts load from Google Fonts (see caveats).

**Spacing.** 4 px grid (`--space-1…12`). Card head 16/18, body 16/18; control gap 8; stack 16; table cells 11 × 16; page 28 top / 20 sides / 72 bottom; page measure 74 rem, Markdown 46 rem, lede 36 rem, display 22 rem, dialog 26 rem, marketing 72 rem.

**Corners.** `--radius-1` 4 px controls, inputs, badges, nav pills · `--radius-2` 8 px cards, drop zone, code, dialogs · `--radius-3` 12 px sheets and marketing panels · pill for bars. (Shipped product uses 2 px; softened one step by decision.)

**Borders.** 1 px everywhere. Neutral hairlines (`--border-1/2`) between rows and around secondary controls; violet hairlines at 14 % (`--border-brand-faint`) on cards/scenes/footer, 22 % (`--border-brand`) on header, nodes, scene-nav, 55 % (`--border-brand-strong`) on the primary button and charged elements. The URL field is the one place with a 2 px bottom edge.

**Shadows and glow.** Depth is black (`--shadow-card` 0 16 48 / .28, `--shadow-dialog`). Charge is violet light (`--shadow-glow-xs … xl`, `--shadow-glow-inset`). They stack: dialog = glow-lg + dialog. Glow appears only on: the cube (breathing), the primary button, the charged card (drop zone), the drop icon, the URL field, progress bars, focus rings, selected nav/segments (inset), conduit units, charged nodes. Never on body copy.

**Cards.** Translucent surface (86 %), 14 % violet hairline, 8 px radius, depth shadow. Head = 18 px title + mono hint right-aligned; body padded or `tight` for tables. At most one **charged** card per page.

**Buttons.** Primary = `#16102a` fill, lit-filament label, 55 % violet border, glow-xs; hover `#22183e` + glow-md. Secondary = surface + `--line` border; hover raised. Outline = transparent + line; hover violet border + 8 % tint. Ghost = text only, 32 px. Danger = rose outline. Heights 40 / 36 / 32; 44 px minimum touch on phones. `charged` adds a 3.2 s breathing glow — one CTA per page, marketing only.

**Hover / press / focus / selected.** Hover: background tint (`--bg-hover` 8 %), label → `--fg-hot`, 120 ms ease-out. Press: `translateY(1px)` on buttons; nav gets the 20 % pressed tint. Focus-visible: 2 px canvas gap + 2 px violet ring + glow-xs, never the default outline. Selected (nav, segment, "you" row): 14 % violet + inset glow. Disabled: opacity .5.

**Motion.** 120 ms hover, 200 ms state, 350 ms layout (bar width), all `cubic-bezier(.2,.8,.2,1)`. The cube breathes on a 5 s loop (drop-shadow 6 → 14 px). Energon units travel a conduit in 2.8 s (`--dur-flow`), producer → consumer, staggered thirds. Flash banners rise 8 px in. `prefers-reduced-motion` collapses everything.

**Transparency and blur.** Cards 86 %, header 92 %, scenes 72 % over the wash. No backdrop blur (the product blurs the header on pointer devices; dropped here — translucency alone reads well and avoids capture artefacts).

**Layout.** Sticky header (60 px) → page (74 rem, left-aligned display + lede) → stacked cards → optional footer line. Two-column grids at ≥ 860 px (stats panes, setup, about scenes); single column < 720 px with full-width controls and stacked actions. Tables collapse to name + meta + one "more" action on phones. Marketing: 72 rem measure, sections separated by a fading violet divider, hero scene = nodes → conduits → cube → conduits → nodes.

**Imagery.** None photographic. One line-art illustration (`assets/energon-workflows-overview.svg`, violet strokes + `#f3ecff` highlights + glow). About-page diagrams in the product are code-generated SVG; the kit replaces them with the Conduit/Flow motif. Terminal panels (`.en-terminal`) are the marketing "screenshot" — mono, colour-coded prompt/comment/ok/url.

**Density.** Comfortable app density: 44 px rows, 36–40 px controls, 15 px body. Not a dashboard, not a doc.

---

## Iconography

- **Product icons** come verbatim from `src/hub.client.js` `ICONS`: 24 px grid, 1.75 stroke, round caps/joins, `currentColor`, `fill="none"` (except `more`, filled dots). Set: download, clipboard, check, trash, more, lock, dice. Stored as `assets/icons/*.svg` + `assets/icons/icons.js`, and as `<Icon name>` in `components/actions/Icon.jsx`.
- **Additions** (same grammar, flagged): arrow, x, external, key, person, terminal, fork — needed by the marketing page, Flow nodes and Sheet.
- **The cube** (`assets/logo.svg`, `CubeMark`) is the only pictogram: brand mark, favicon, drop-zone icon, hero object, "Energon" node in flows. Never redraw it. The **energon unit** (6 px rotated square with glow, `Unit`) is the only other glyph — bullet, status dot, kicker prefix.
- No icon font, no third-party set, no emoji. If a glyph is missing, draw it on the 24 px / 1.75 grid and add it to `Icon.jsx`.
- Icons always carry a label (IconButton requires one).

---

## Components

Source-defined families (from `src/chrome.css` + the hub templates), grouped by concern; each directory has a `*.card.html` specimen. Components are thin React wrappers over `.en-*` classes in `components/components.css`, so the same look is available to plain HTML.

- `components/brand/` — **Logo**, **CubeMark**, **Conduit**, **Unit**, **Flow**
- `components/actions/` — **Button**, **IconButton**, **Icon**
- `components/forms/` — **Field**, **Input**, **Select**, **SegmentedControl**, **PasswordField**, **UrlField**
- `components/data/` — **Table**, **Badge**, **Metric** / **Metrics**, **ProgressBar** / **PersonRow**, **CopyRow** / **CopyBlock**
- `components/feedback/` — **Flash** / **TokenReveal**, **EmptyState**, **Dialog**, **Sheet**
- `components/layout/` — **AppHeader**, **AppFooter**, **Card**, **PageTitle**, **DropZone**

**Intentional additions:** Conduit / Unit / Flow (the energy-transfer motif, requested by the owner for the marketing surface); seven extra icons (above). No Toast, Tooltip, Checkbox, Switch or Skeleton — the product doesn't have them.

**Namespace:** `window.EnergonDesignSystem_6ff486` (from `_ds_bundle.js`). `components/_card-loader.js` (`EN.ready()`) falls back to compiling sources in-page when the bundle isn't present, so cards and kits render either way.

---

## Index

- `styles.css` — entry point (imports tokens + `components/components.css`)
- `tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `effects.css`, `base.css`
- `components/` — `components.css`, `_card-loader.js`, six groups above (each `Name.jsx` + `Name.d.ts` + `Name.prompt.md`, one `*.card.html`)
- `guidelines/` — 22 foundation cards: Colors (violet, ink, glow, semantic, status, light), Type (display, app, mono, scale), Spacing (scale, usage, corners), Effects (depth & charge, motion, states, wash), Brand (cube, lockups, conduits, illustration, voice)
- `assets/` — `logo.svg`, `energon-workflows-overview.svg`, `icons/` (7 product SVGs + cube + `icons.js`)
- `ui_kits/hub/` — click-through hub: Hub (drop → stage → publish, catalog, dialogs, sheet), Tokens, Setup, Connect, About, Stats, Gate, Markdown; dark / light toggle
- `ui_kits/marketing/` — landing page: hero + demo scene, how it works, agents (two chat sessions), self-host, footer (Docs / GitHub + @trevin credit)
- `thumbnail.html` — homepage tile
- `github.md` — source association + screen map
- `SKILL.md` — agent skill entry point

## Caveats

- **Fonts are not self-hosted.** The repo ships no binaries; IBM Plex Sans/Mono and Michroma load from Google Fonts via `tokens/fonts.css`. Michroma is a design-system substitution for "a wide technical display face" (chosen over Chakra Petch, Archivo Expanded and Syncopate — specimens in `explorations/type/`); swap it if you have a licensed face in mind; drop woff2s in `assets/fonts/` and replace the `@import` with `@font-face`.
- The About-page scene diagrams are generated SVG in `src/about.ts`; the kit shows the Conduit/Flow motif in their place rather than re-drawing them.
- The light theme is untested against real users; the product is dark-only.
- The marketing page is new design (the repo has none); copy is drawn from STRATEGY.md and README.md but has not been reviewed by the owner.
