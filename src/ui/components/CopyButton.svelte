<script lang="ts">
  import { onDestroy } from 'svelte';
  import Button from './Button.svelte';
  import IconButton from './IconButton.svelte';
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
{#if iconOnly}<IconButton {id} {size} {iconSize} icon={copied ? 'check' : 'clipboard'} label={copied ? 'Copied' : label} onclick={copy} />
{:else}<Button {id} variant="ghost" size="sm" onclick={copy}>{copied ? 'Copied' : label}</Button>{/if}
{#if error}<span class="en-note" role="alert">{error}</span>{/if}
