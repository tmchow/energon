<script lang="ts">
  import { onDestroy } from 'svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  let { text, label = 'Copy', iconOnly = false, id, size = 'md', iconSize }: { text: string; label?: string; iconOnly?: boolean; id?: string; size?: 'sm' | 'md'; iconSize?: number } = $props();
  let copied = $state(false);
  let error = $state('');
  let timer: ReturnType<typeof setTimeout>;
  onDestroy(() => clearTimeout(timer));
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      error = '';
      copied = true;
      clearTimeout(timer);
      timer = setTimeout(() => copied = false, 1200);
    } catch { error = 'Copy failed. Select and copy the text manually.'; }
  }
</script>
{#if iconOnly}
  <button type="button" {id} class="en-icon-btn en-icon-btn--{size} en-icon-swap" data-state={copied ? 'copied' : 'idle'} data-tip={copied ? 'Copied' : label} aria-label={copied ? 'Copied' : label} onclick={copy}>
    <span class="en-icon-swap-layer" data-icon="idle"><Icon name="clipboard" size={iconSize} /></span>
    <span class="en-icon-swap-layer" data-icon="copied"><Icon name="check" size={iconSize} /></span>
  </button>
{:else}<Button {id} variant="ghost" size="sm" onclick={copy}>{copied ? 'Copied' : label}</Button>{/if}
{#if error}<span class="en-note" role="alert">{error}</span>{/if}
