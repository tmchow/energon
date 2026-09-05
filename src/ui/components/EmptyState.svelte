<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, children, action }: { title: string; children?: Snippet; action?: Snippet } = $props();
</script>
<div class="en-empty"><strong>{title}</strong>{@render children?.()}{@render action?.()}</div>
