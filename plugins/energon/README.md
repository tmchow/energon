# Energon plugin (`energon`)

Install this plugin from **your company’s Energon repo** (the fork you instantiated), not from a placeholder host. Claude Code and [Agent Plugins](https://agent-plugins.org/) hosts use the same marketplace. Install at user (global) scope unless the human asked for a project-level install.

After the host exists, mint a token at `{origin}/tokens` and export it as the env named in `GET {origin}/v1/help`.

Humans and agents: [INSTALL.md](../../INSTALL.md). Copy-paste prompts: [README.md](../../README.md).
