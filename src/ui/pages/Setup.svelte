<script lang="ts">
  import type { SetupData } from '../types';
  import PageTitle from '../components/PageTitle.svelte';
  import Card from '../components/Card.svelte';
  import CopyRow from '../components/CopyRow.svelte';
  import CopyBlock from '../components/CopyBlock.svelte';
  let { data }: { data: SetupData } = $props();
</script>
<main class="en-wrap">
  <PageTitle title="Add Energon to your agent." wide>
    <p class="en-lede">Give your agent a way to publish work, read a link as reference, or revise a file at the same address when permitted. The same instance-specific skill works across compatible agent tools. You can also <a href="/">upload from your browser</a>.</p>
    <p class="en-lede">Install this instance's plugin in <strong>Claude Code</strong> or a compatible <a href="https://agent-plugins.org/">Agent Plugins</a> client, such as Cursor, OpenClaw, ChatGPT, Codex, or GitHub Copilot. Install at user (global) scope so it follows you across projects. Then ask your agent to connect: it will give you a link and code to approve here. You can also mint a token on <a href="/tokens">Tokens</a> and export it as <code>{data.identity.tokenEnv}</code>.</p>
  </PageTitle>
  <div class="en-stack en-setup-stack">
    <Card title="Marketplace" hint="Use the form your agent tool asks for">
      <p class="en-muted-copy">Add this as a plugin marketplace, then install <code>{data.identity.plugin}</code> (<code>{data.identity.plugin}@{data.identity.marketplace}</code>) at user (global) scope. Project or workspace only if you asked for this repo.</p>
      <CopyRow label="GitHub repo" value={data.identity.repo || 'your-org/energon'} />
      <CopyRow label="Repo URL" value={data.identity.repo ? `https://github.com/${data.identity.repo}` : data.identity.origin} />
    </Card>
    <Card title="Or paste this into your agent" hint="Let your agent guide the install">
      <p class="en-muted-copy">Paste these instructions into your agent to connect it to this instance.</p>
      <CopyBlock text={data.install} id="agent-install" />
    </Card>
  </div>
  <p class="en-lede en-setup-next">Once connected, try “Publish this brief and give me its link,” “Read this link as reference without changing it,” or “Update this file at the same link.” A stable link shows current contents until expiry or deletion.</p>
</main>
