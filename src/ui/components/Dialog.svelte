<script lang="ts">
  import type { Snippet } from 'svelte';
  const generatedId = $props.id();
  let { open = $bindable(false), title, message, children, actions, onClose, id = generatedId, sheet = false, dismissible = true }:
    { open?: boolean; title: string; message?: string; children?: Snippet; actions?: Snippet; onClose?: () => void; id?: string; sheet?: boolean; dismissible?: boolean } = $props();
  let dialog: HTMLDialogElement;
  $effect(() => {
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });
  function close() { open = false; onClose?.(); }
</script>
<dialog bind:this={dialog} {id} class="en-dialog" class:en-sheet={sheet} aria-labelledby="{id}-title" aria-describedby={message ? `${id}-message` : undefined}
  onclose={close} oncancel={e => { if (!dismissible) e.preventDefault(); }}
  onclick={e => { if (dismissible && e.target === dialog) open = false; }}>
  {#if sheet}
    <div class="en-sheet-head"><h3 id="{id}-title">{title}</h3>{#if message}<p class="en-muted" id="{id}-message">{message}</p>{/if}</div>
    {@render children?.()}
  {:else}<div class="en-dialog-form">
    <h3 id="{id}-title">{title}</h3>
    {#if message}<p class="en-muted" id="{id}-message">{message}</p>{/if}
    {@render children?.()}
    {#if actions}<div class="en-dialog-actions">{@render actions()}</div>{/if}
  </div>{/if}
</dialog>
