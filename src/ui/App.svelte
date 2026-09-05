<script lang="ts">
  import type { PageProps } from './types';
  import AppHeader from './components/AppHeader.svelte';
  import AppFooter from './components/AppFooter.svelte';
  import Setup from './pages/Setup.svelte';
  import Tokens from './pages/Tokens.svelte';
  import Connect from './pages/Connect.svelte';
  import Stats from './pages/Stats.svelte';
  import About from './pages/About.svelte';
  import Gate from './pages/Gate.svelte';
  import Markdown from './pages/Markdown.svelte';
  import Hub from './pages/Hub.svelte';
  let props: PageProps = $props();
</script>
{#if 'email' in props.data && props.page !== 'connect'}<AppHeader active={props.page} email={props.data.email} />{/if}
{#if props.page === 'hub'}<Hub data={props.data} />
{:else if props.page === 'setup'}<Setup data={props.data} />
{:else if props.page === 'tokens'}<Tokens data={props.data} />
{:else if props.page === 'connect'}<Connect data={props.data} />
{:else if props.page === 'stats'}<Stats data={props.data} />
{:else if props.page === 'about'}<About />
{:else if props.page === 'gate'}<Gate data={props.data} />
{:else if props.page === 'markdown'}<Markdown data={props.data} />{/if}
{#if props.page !== 'gate' && props.page !== 'markdown' && props.page !== 'connect'}<AppFooter text={props.footer} />{/if}
