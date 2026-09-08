<script lang="ts">
  import type { Snippet } from 'svelte';
  let { label, note, htmlFor, noteId, error, errorId, children, action, className = '' }:
    { label?: string; note?: string; htmlFor?: string; noteId?: string; error?: string; errorId?: string; children?: Snippet; action?: Snippet; className?: string } = $props();
</script>
<div class="en-field {className}" class:en-field--invalid={!!error}>
  {#if label || action}
    <div class="en-field-head">
      {#if label}{#if htmlFor}<label for={htmlFor}>{label}</label>{:else}<span>{label}</span>{/if}{/if}
      {@render action?.()}
    </div>
  {/if}
  {@render children?.()}
  {#if note}<span id={noteId} class="en-note">{note}</span>{/if}
  {#if error}<span id={errorId} class="en-field-error" role="alert">{error}</span>{/if}
</div>
