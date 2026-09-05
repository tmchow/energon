<script lang="ts">
  import type { Snippet } from 'svelte';
  import Unit from './Unit.svelte';
  let { kicker, title, lede, wide = false, children }:
    { kicker?: string; title: string; lede?: string; wide?: boolean; children?: Snippet } = $props();
</script>
{#if kicker}<p class="en-kicker"><Unit size={5} />{kicker}</p>{/if}
<h1 class="en-display" class:en-display--wide={wide}>{title}</h1>
{#if lede}<p class="en-lede">{lede}</p>{/if}
{@render children?.()}
