<script lang="ts">
  import PageTitle from '../components/PageTitle.svelte';
  import Flow from '../components/Flow.svelte';
  import { scenes } from '../about-scenes';
  import type { IconName } from '../icons';
  const nodes: { label: string; icon?: IconName; cube?: boolean; charged?: boolean }[][] = [
    [{ label: 'Folder', icon: 'download' }, { label: 'Energon', charged: true, cube: true }, { label: 'Browser', icon: 'external' }],
    [{ label: 'Session A', icon: 'terminal' }, { label: '/f/{id}/file', charged: true }, { label: 'Session B', icon: 'terminal' }],
    [{ label: 'Ada', icon: 'person' }, { label: 'notes.md', charged: true }, { label: 'Bob', icon: 'person' }],
    [{ label: 'Mon' }, { label: 'Wed' }, { label: 'Fri', charged: true }],
    [{ label: 'Sign in', icon: 'person' }, { label: 'A token', icon: 'key' }, { label: 'Public', charged: true, icon: 'external' }],
  ];
</script>
<main class="en-wrap">
  <PageTitle title="Why use Energon?">
    <p class="en-lede">Agent-native publishing for documents, prototypes, and working files. Built for agents to publish, read, reference, and revise ordinary files. Ready for people to open, explore, and upload directly. Permitted updates keep the same URL across sessions and agent tools.</p>
    <p class="en-lede">Once yours is running: no repo to create, no deployment pipeline to configure, no new link for every update. Publish prepared files from your browser or your agent. <a href="https://github.com/tmchow/energon#deploy-your-own-energon">Want to deploy your own Energon?</a> It runs in your Cloudflare account.</p>
  </PageTitle>
  <nav class="en-scene-nav" aria-label="Scenes">{#each ['Prototype', 'Read and reference', 'Revise', 'Keep or copy', 'Public links'] as label, i}<a href="#{scenes[i].id}">{label}</a>{/each}</nav>
  {#each scenes as scene, i}<section class="en-scene" id={scene.id}>
    <div><p class="en-scene-kicker">{scene.n}</p><h2>{scene.title}</h2>{#each scene.paragraphs as paragraph}<p>{@html paragraph}</p>{/each}</div>
    <figure class="en-diagram"><div class="en-scene-flow"><Flow nodes={nodes[i]} duration="{2.6 + i * 0.3}s" /></div><figcaption>{scene.caption}</figcaption></figure>
  </section>{/each}
</main>
