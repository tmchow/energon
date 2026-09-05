<script lang="ts">
  import type { Snippet } from 'svelte';
  let { label, note, htmlFor, noteId, children, className = '' }:
    { label?: string; note?: string; htmlFor?: string; noteId?: string; children?: Snippet; className?: string } = $props();
</script>
<div class="en-field {className}">
  {#if label}<label for={htmlFor}>{label}</label>{/if}
  {@render children?.()}
  {#if note}<span id={noteId} class="en-note">{note}</span>{/if}
</div>
