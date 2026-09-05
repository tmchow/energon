<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, hint, headEnd, charged = false, tight = false, children, className = '', id }:
    { title?: string; hint?: string; headEnd?: Snippet; charged?: boolean; tight?: boolean; children?: Snippet; className?: string; id?: string } = $props();
</script>
<section {id} class="en-card {className}" class:en-card--charged={charged}>
  {#if title || hint || headEnd}<div class="en-card-head">{#if title}<h2>{title}</h2>{/if}{#if headEnd}{@render headEnd()}{:else if hint}<span class="en-card-hint">{hint}</span>{/if}</div>{/if}
  <div class="en-card-body" class:en-card-body--tight={tight}>{@render children?.()}</div>
</section>
