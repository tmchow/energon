# Energon

You made a prototype in a chat, or a brief, or a screenshot. Now it has to leave that session. A coworker needs to see it. Tomorrow's agent needs the current bytes. The usual path is a pile of tools built for a person who is already signed in: a static host for the HTML, Drive or Notion for the writeup, Slack for the image. You spend longer sharing than you did making it. An agent cannot publish to those places, and it cannot GET a Drive link with a token.

What you want is simpler. Drop the folder and send a link. They see the prototype in the browser, not a zip. Put the markdown up and they get a formatted page. The next agent reads the same file over HTTP. You replace it later and the address does not move.

Energon is that host, for your company. People and agents publish with a token. The published link is public on purpose. A coworker opens it. Someone outside the company opens it. An agent does not need a login cookie. That is the point: sharing inside the company has no extra gate, and sending a preview out is the same link. If a given URL should not be on the open web, put a share password on it, or put Access on those paths. Writing stays private. Tokens decide who can publish, and you can lock one object so only its creator can overwrite it.

You deploy it on the company's Cloudflare account, next to Access, DNS, and whatever else you already run there. Nobody else is in the middle of that. The hostname is yours.

- **Worker.** This repo. The hub, the `/v1` API, and the viewer. Published links are served from here. Repeat views can hit the edge cache.
- **R2.** The files.
- **D1.** Slugs, handles, token hashes, expiry, and who may write.
- **Access.** Who can sign in and mint a key. Published links skip it unless you add it.

This repo is what you fork. Point the skill at your origin. Teammates install from your fork.

A site is a named folder, like `/ada/s/lunch-poll/`. A file is one object with a short id, like `/ada/f/x7k2/brief.md`. POST once to mint the id, then PUT to replace it. `curl` and `?raw=1` stay the source. `index.md` is the homepage when `index.html` is missing. Last write wins on each path, because you are taking turns on the live object, not merging.

Who can mint tokens, the default write policy, and how long things live are settings on the host. Companies usually let any token on the host write, and leave expiration off. [Deploy your own Energon](./docs/DEPLOY.md) has the list.

`GET /v1/sites` and `GET /v1/files` only return what you created or last wrote. They are not a company catalog.

The skill in this tree is `energon@energon`, aimed at `https://energon.example.com`. That host is not real. Run `npm run skill:init` with your hostname before anyone installs the skill. Default token env is `ENERGON_TOKEN`.

## Give this to an agent

Same steps for you or an agent: [INSTALL.md](./INSTALL.md). Paste one of these.

### Stand up a company host

```
Read INSTALL.md in this repository and stand up an Energon host for our company.

Follow INSTALL.md exactly. Ask me for our public hostname, who may mint tokens, and whether coworkers' tokens should overwrite each other's files (WRITE_POLICY=instance) or only the creator (owner).

Do not invent a token. Do not reuse another instance's D1 database_id or R2 bucket. After skill:init, commit the rendered skill so teammates install from this fork.
```

### Connect an agent to a host that exists

```
Read INSTALL.md in this repository, section "Connect an agent", and install Energon for this machine.

Ask me for our Energon origin (https://...) if it is not already in the environment or INSTALL.md. I will mint a token at {origin}/tokens and paste the secret. Export it as the token env named by GET {origin}/v1/help. Install the skill from our company repo at user (global) scope. Do not invent a token.
```

`{origin}/setup` has the same block already filled in for your host.

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

CI runs typecheck, lint, and both suites on every pull request and every push to `main`. Production deploy is opt-in. See [INSTALL.md](./INSTALL.md).

## License

[MIT](./LICENSE)
