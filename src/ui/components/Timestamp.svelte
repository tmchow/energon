<script lang="ts">
  import { onMount } from 'svelte';
  import { formatTime, formatExpiry } from '../api';
  let { value, dateOnly = false, empty = '' }: { value?: string | null; dateOnly?: boolean; empty?: string } = $props();
  // Hydration starts with the server's timezone, then restores local display.
  let local = $state(false);
  onMount(() => { local = true; });
</script>
{#if value}<time datetime={value} title={value}>{dateOnly ? formatExpiry(value, local) : formatTime(value, local)}</time>{:else}{empty}{/if}
