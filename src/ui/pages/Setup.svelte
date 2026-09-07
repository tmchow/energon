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
    <p class="en-lede">Give your agent a way to publish work, read a link as reference, or revise a file at the same address when permitted. The same skill works across compatible agent tools. You can also <a href="/">upload from your browser</a>.</p>
    <p class="en-lede">Install this Energon's plugin in your agent at user (global) scope so it follows you across projects. Then ask your agent to connect. It shows you a link and a code; open the link, enter the code, and approve. The agent receives its token directly and saves it as <code>{data.identity.tokenEnv}</code>. No copying tokens around. For CI, scheduled jobs, or a hosted sandbox with a secret store, <a href="/tokens">mint a token</a> yourself instead.</p>
  </PageTitle>
  <div class="en-stack en-setup-stack">
    <Card title="Marketplace" hint="Use the form your agent tool asks for">
      <p class="en-muted-copy">Add this repo as a plugin marketplace, then install <code>{data.identity.plugin}</code> (<code>{data.identity.plugin}@{data.identity.marketplace}</code>) at user (global) scope.</p>
      <CopyRow label="GitHub repo" value={data.identity.repo || 'your-org/energon'} />
      <CopyRow label="Repo URL" value={data.identity.repo ? `https://github.com/${data.identity.repo}` : data.identity.origin} />
    </Card>
    <Card title="Or paste this into your agent" hint="Install and connect in one step">
      <p class="en-muted-copy">Your agent installs the plugin, then asks you to approve its connection.</p>
      <CopyBlock text={data.install} id="agent-install" />
    </Card>
  </div>
  <p class="en-lede en-setup-next">Once connected, try “Publish this brief and give me its link,” “Read this link as reference without changing it,” or “Update this file at the same link.” A stable link shows current contents until expiry or deletion.</p>
</main>
