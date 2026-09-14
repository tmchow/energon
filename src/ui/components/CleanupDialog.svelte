<script lang="ts">
  import type { AdminCleanupPreview } from '../types';
  import { formatBytes } from '../../config';
  import Dialog from './Dialog.svelte';
  import Button from './Button.svelte';
  import Field from './Field.svelte';
  import Input from './Input.svelte';
  import Flash from './Flash.svelte';
  type Action = 'set_ttl' | 'delete' | 'expire';
  const SAMPLE_LIMIT = 5;
  let { open = $bindable(false), preview, action, pending, busy = false, error = '', id, sampleId, onConfirm }:
    { open?: boolean; preview: AdminCleanupPreview | null; action: Action; pending: string; busy?: boolean; error?: string; id: string; sampleId: string; onConfirm: () => void } = $props();
  let value = $state('');
  $effect(() => { if (open || preview) value = ''; });
  const verb = $derived(action === 'delete' ? 'Delete' : action === 'expire' ? 'Expire soon' : 'Set expiry');
  const eligibleLabel = $derived(preview ? `${preview.eligible} ${preview.eligible === 1 ? 'object' : 'objects'}` : '');
  const message = $derived(!preview
    ? `Checking ${pending}…`
    : preview.eligible === 0
      ? 'Nothing you can change matches this selection.'
      : action === 'delete'
        ? `There is no recycle bin. ${eligibleLabel} will be removed.`
        : action === 'expire'
          ? `${eligibleLabel} you own will get a 30-minute grace.`
          : `${eligibleLabel} will expire in ${preview.ttl || '7d'}. The owner sees Expires and can push it back.`);
  const ready = $derived(!!preview && preview.eligible > 0);
  const shown = $derived(preview ? preview.sample.slice(0, SAMPLE_LIMIT) : []);
  const more = $derived(preview ? Math.max(0, preview.eligible - shown.length) : 0);
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!busy && ready && value === eligibleLabel) onConfirm();
  }
</script>
<Dialog {id} bind:open title={verb} {message} dismissible={!busy}>
  {#if error}<Flash tone="err">{error}</Flash>{/if}
  {#if preview}
    <dl class="en-cleanup-facts">
      <div><dt>Matched</dt><dd>{preview.matched}</dd></div>
      <div><dt>Eligible</dt><dd>{preview.eligible}</dd></div>
      <div><dt>Storage</dt><dd>{formatBytes(preview.bytes)}</dd></div>
      {#if preview.skipped.total}<div><dt>Skipped</dt><dd>{preview.skipped.total}</dd></div>{/if}
    </dl>
    {#if shown.length}
      <ul id={sampleId} class="en-cleanup-sample">
        {#each shown as row (`${row.kind}:${row.ref}`)}<li><span class="en-cleanup-sample-name">{row.name}</span><span class="en-cleanup-sample-size">{formatBytes(row.bytes)}</span></li>{/each}
        {#if more > 0}<li class="en-cleanup-sample-more">and {more} more</li>{/if}
      </ul>
    {/if}
  {/if}
  <form onsubmit={submit}>
    {#if ready}
      <Field label={`Type “${eligibleLabel}” to confirm`} htmlFor="{id}-input"><Input id="{id}-input" bind:value mono placeholder={eligibleLabel} required autocomplete="off" disabled={busy} /></Field>
      <p class="en-note">Type the exact count.</p>
    {/if}
    <div class="en-dialog-actions">
      <Button onclick={() => open = false} disabled={busy}>Cancel</Button>
      {#if ready}<Button id="{id}-ok" type="submit" variant={action === 'delete' ? 'danger' : 'primary'} disabled={busy || value !== eligibleLabel}>{busy ? `${verb}…` : verb}</Button>{/if}
    </div>
  </form>
</Dialog>
