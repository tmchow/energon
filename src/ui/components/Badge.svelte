<script lang="ts">
  import type { Snippet } from 'svelte';
  import Unit from './Unit.svelte';
  let { tone, unit = false, children }: { tone?: 'lock' | 'ttl' | 'ok' | 'warn' | 'danger' | 'charged'; unit?: boolean; children?: Snippet } = $props();
</script>
<span class="en-badge {tone ? `en-badge--${tone}` : ''}">{#if unit}<Unit size={5} dim={tone !== 'charged' && tone !== 'lock'} />{/if}{@render children?.()}</span>
