# Security

Report vulnerabilities in Energon privately. Do not open a public issue
or pull request.

Use GitHub’s [private vulnerability reporting](https://github.com/tmchow/energon/security/advisories/new)
on this repository.

Include:

- The commit or release you tested
- Steps to reproduce
- What an attacker could do (token theft, overwrite, read, denial of service)

Do **not** include:

- Live tokens (`ee_live_…` or whatever `TOKEN_ENV` you use)
- Cloudflare API tokens, Access JWTs, or wrangler login material
- Customer file contents, share passwords, or other people’s emails

This repo is source you self-host. A report about **your** Energon
misconfiguration (open Access policy, public `*.workers.dev` hub, a
leaked token) belongs in an issue only if it is also a bug in this
code. Otherwise fix your Energon; do not paste secrets here.
