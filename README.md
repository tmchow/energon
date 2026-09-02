# Energon

Energon is a company host for files and small sites. An agent publishes over HTTP. A person opens the link.

It is agent-native on purpose. The same skill works from Cursor, Claude Code, Codex, and other clients that install [Agent Plugins](https://agent-plugins.org/). Markdown, a folder of HTML, a screenshot, a PDF: one place, not a static host plus Drive plus Slack. You run it in your Cloudflare account, so the bytes are not sitting on a public paste service. Teammates with a token can read and write. You can lock a site or a file so only the creator overwrites it. You can still send the link to someone outside the company.

Team members authenticate to mint a token. Published URLs are open by default, because an agent has no login cookie and a preview for someone outside the company is the same URL. Anyone with the link can open it. Put a share password on a URL that should not be wide open. Token reads on `/v1` skip the password. Writing stays on tokens.

This repo is what you fork. `npm run skill:init` writes a plugin package named for your host (`yourco-energon`, `YOURCO_ENERGON_TOKEN`) and the marketplace catalogs teammates add, so it does not collide with another Energon you also use. Install that skill at user scope if this is the host you want in every project. If you belong to more than one organization, install each instance's skill. They have different names and different token env vars. Or pin one at project scope in that company's repos.

A site is a named folder, like `/ada/s/lunch-poll/`. A file is one object with a short id, like `/ada/f/x7k2/brief.md`. POST once to mint the id, then PUT to replace it. The address does not move. `curl` and `?raw=1` stay the source. `index.md` is the homepage when `index.html` is missing. Last write wins on each path.

Who can mint tokens, the default write policy, and how long things live are settings on the host. Companies usually let any token on the host write, and leave expiration off. [Deploy your own Energon](./docs/DEPLOY.md) has the list.

`GET /v1/sites` and `GET /v1/files` only return what you created or last wrote. They are not a company catalog.

The package in this upstream tree is `plugins/energon`, aimed at `https://energon.example.com`. That host is not real, and this tree is not a marketplace. Run `npm run skill:init` with your hostname before anyone installs the skill. Default token env is `ENERGON_TOKEN`.

## Where this came from

[Claude Artifacts](https://claude.com/blog/artifacts) is really easy. An HTML app, a link, someone can open it. Only inside Claude products, though. Bounce across agents in different harnesses and you cannot reach for the same thing.

[ht-ml.app](https://ht-ml.app) is the version of that idea that is not stuck in one chat product. It is shaped around HTML, and it is a public host.

[Proof](https://www.proofeditor.ai) is great because it is markdown. It is simple, and there is also a lot of it. It sits between Google Docs and something more agent-native, and markdown-only is limiting.

I saw [Shopify Quick](https://shopify.engineering/quick) last year and thought it was genius. A folder becomes a link, on your own infrastructure. I did not find an easy way that matched my preferences, so I built Energon.

I wanted one place an agent can write from whatever agent I am in. A small site, a markdown doc, an image, a file. Running in our Cloudflare account instead of a public service. Teammates can read and write. A site or a file can be limited to the person who created it. A link can still go to someone outside the company. The skill lives in the instance repo and is named for that host, so two organizations do not step on each other. Plenty of people have already made Quick-shaped tools, Open Quick and others. This is the combination I wanted.

## Give this to an agent

Same steps for you or an agent: [INSTALL.md](./INSTALL.md). Paste one of these.

### Stand up a company host

```
Read INSTALL.md in this repository and stand up an Energon host for our company.

Follow INSTALL.md exactly. Ask me for our public hostname, who may mint tokens, and whether coworkers' tokens should overwrite each other's files (WRITE_POLICY=instance) or only the creator (owner).

Do not invent a token. Do not reuse another instance's D1 database_id or R2 bucket. After skill:init, commit the generated plugin and catalogs so teammates install from this fork.
```

### Connect an agent to a host that exists

```
Read INSTALL.md in this repository, section "Connect an agent", and install Energon for this machine.

Ask me for our Energon origin (https://...) if it is not already in the environment or INSTALL.md. I will mint a token at {origin}/tokens and paste the secret. Export it as the token env named by GET {origin}/v1/help. Install the skill from our company repo at user (global) scope. If I already use another Energon, this skill has a different name. Install it too, or pin it in this repo. Do not invent a token.
```

`{origin}/setup` has the same block already filled in for your host.

## What you deploy

The Worker is this repo: the hub, the `/v1` API, and the viewer. Files live in R2. D1 holds slugs, handles, token hashes, expiry, and who may write. Cloudflare Access is who can authenticate and mint a key. Published links skip it unless you put it on those paths. Repeat views can hit the edge cache. The rest is in [INSTALL.md](./INSTALL.md) and [docs/DEPLOY.md](./docs/DEPLOY.md).

## Run it on your machine

```bash
npm install
npx wrangler d1 migrations apply energon --local
cp .dev.vars.example .dev.vars
npm run dev
```

Open http://127.0.0.1:8787. Sign-in is off on localhost. Identity defaults to `dev@example.com`. Set `DEV_ACCESS_EMAIL` in `.dev.vars` to change it.

```bash
npm test
```

`npm run test:unit` is the fast Node suite. `npm run test:worker` boots the app. Which file to run while you edit is in [AGENTS.md](./AGENTS.md).

CI runs typecheck, lint, and both suites on pushes to `main` and on any PR that is opened. Production deploy is opt-in. See [INSTALL.md](./INSTALL.md).

## Contributing

Issues are welcome. Pull requests against `tmchow/energon` are not merged. Fork the repo to run your own host, and keep instance changes on that fork. Details: [CONTRIBUTING.md](./CONTRIBUTING.md). Security reports: [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
