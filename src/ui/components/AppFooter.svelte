<script lang="ts">
  import type { Snippet } from 'svelte';
  let { text = '', right }: { text?: string; right?: Snippet } = $props();
</script>
{#if text.trim() || right}<footer class="en-footer"><div class="en-footer-inner"><span>{text.trim()}</span>{@render right?.()}</div></footer>{/if}
