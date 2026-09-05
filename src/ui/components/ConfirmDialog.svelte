<script lang="ts">
  import Dialog from './Dialog.svelte';
  import Button from './Button.svelte';
  import Field from './Field.svelte';
  import Input from './Input.svelte';
  import Flash from './Flash.svelte';
  let { open = $bindable(false), title, message, label, initial = '', match, action, danger = false, busy = false, onConfirm, id = 'dlg', error = '' }:
    { open?: boolean; title: string; message: string; label?: string; initial?: string; match?: string;
      action: string; danger?: boolean; busy?: boolean; onConfirm: (value: string) => void; id?: string; error?: string } = $props();
  let value = $state('');
  $effect(() => { if (open) value = initial; });
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!busy && (match === undefined || value === match)) onConfirm(value);
  }
</script>
<Dialog {id} bind:open {title} {message} dismissible={!busy}>
  {#if error}<Flash tone="err">{error}</Flash>{/if}
  <form onsubmit={submit}>
    {#if label}<Field {label} htmlFor="{id}-input"><Input id="{id}-input" bind:value mono placeholder={match} required autocomplete="off" disabled={busy} /></Field>{/if}
    {#if match !== undefined}<p class="en-note">Type the exact {action === 'Revoke' ? 'label' : 'name'}.</p>{/if}
    <div class="en-dialog-actions"><Button onclick={() => open = false} disabled={busy}>Cancel</Button><Button id="{id}-ok" type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy || (match !== undefined && value !== match)}>{busy ? `${action}…` : action}</Button></div>
  </form>
</Dialog>
