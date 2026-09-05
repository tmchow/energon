<script lang="ts">
  import Dialog from './Dialog.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from '../icons';
  let { open = $bindable(false), title, meta, items, id = 'more-dlg' }:
    { open?: boolean; title: string; meta?: string; id?: string; items: { label: string; icon?: IconName; danger?: boolean; href?: string; onClick?: () => void }[] } = $props();
</script>
<Dialog bind:open {title} message={meta} {id} sheet>
  <div class="en-sheet-list">{#each items as item}
    {#if item.href}<a class="en-sheet-item" href={item.href} onclick={() => open = false}>{#if item.icon}<Icon name={item.icon} />{/if}{item.label}</a>
    {:else}<button type="button" class="en-sheet-item" class:en-sheet-item--danger={item.danger} onclick={() => { open = false; item.onClick?.(); }}>{#if item.icon}<Icon name={item.icon} />{/if}{item.label}</button>{/if}
  {/each}</div>
  <div class="en-sheet-cancel"><Button variant="ghost" onclick={() => open = false}>Cancel</Button></div>
</Dialog>
