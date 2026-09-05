<script lang="ts">
  import type { Snippet } from 'svelte';
  import Logo from './Logo.svelte';
  let { active, email, end, publicPage = false }: { active?: string; email?: string | null; end?: Snippet; publicPage?: boolean } = $props();
  const links = [['hub', '/', 'Hub'], ['tokens', '/tokens', 'Tokens'], ['setup', '/setup', 'Setup'], ['about', '/about', 'About'], ['stats', '/stats', 'Stats']];
</script>
<header class="en-top" class:en-top--public={publicPage}><div class="en-top-inner">
  <Logo breathe />
  <div class="en-top-end">
    {#if !publicPage}<nav class="en-nav" aria-label="Pages">{#each links as [id, href, label]}<a {href} class:on={active === id} aria-current={active === id ? 'page' : undefined}>{label}</a>{/each}</nav>{/if}
    {#if end}{@render end()}{:else if !publicPage}<div class="en-who" id="who">{email || 'Not signed in'}</div>{/if}
  </div>
</div></header>
