<script lang="ts">
  import type { AdminCleanupPreview } from '../types';
  import { formatBytes } from '../../config';
  import Card from './Card.svelte';
  import Button from './Button.svelte';
  import Table from './Table.svelte';
  import EmptyState from './EmptyState.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import Timestamp from './Timestamp.svelte';
  import Metric from './Metric.svelte';
  type Action = 'set_ttl' | 'delete' | 'expire';
  type Sample = AdminCleanupPreview['sample'][number];
  let {
    preview,
    action,
    confirmOpen = $bindable(false),
    confirmError = $bindable(''),
    busy = false,
    showOwner = false,
    className = '',
    sampleId,
    confirmId,
    confirmButtonId,
    onConfirm,
  }: {
    preview: AdminCleanupPreview | null;
    action: Action;
    confirmOpen?: boolean;
    confirmError?: string;
    busy?: boolean;
    showOwner?: boolean;
    className?: string;
    sampleId: string;
    confirmId: string;
    confirmButtonId: string;
    onConfirm: () => void;
  } = $props();
  const eligibleLabel = $derived(preview ? `${preview.eligible} ${preview.eligible === 1 ? 'object' : 'objects'}` : '');
  const confirmAction = $derived(action === 'delete' ? 'Delete' : action === 'expire' ? 'Expire' : 'Set expiry');
  const confirmMessage = $derived(action === 'delete'
    ? `There is no recycle bin. ${eligibleLabel} will be removed. Type the count to confirm.`
    : action === 'expire'
      ? `${eligibleLabel} you own will get a 30-minute grace. Type the count to confirm.`
      : `${eligibleLabel} will expire in ${preview?.ttl || '7d'}. The owner sees Expires and can push it back. Type the count to confirm.`);
</script>
{#snippet sampleOwner(row: Sample)}{row.owner || '—'}{/snippet}
{#snippet sampleName(row: Sample)}{row.name}{/snippet}
{#snippet sampleSize(row: Sample)}{formatBytes(row.bytes)}{/snippet}
{#snippet sampleWritten(row: Sample)}<Timestamp value={row.updated_at} />{/snippet}
{#snippet sampleRead(row: Sample)}<Timestamp value={row.last_read_at} empty="No recorded read" />{/snippet}
{#snippet sampleExpiry(row: Sample)}<Timestamp value={row.expires_at} dateOnly empty="" />{/snippet}
{#if preview}
  <Card title="Preview" {className} tight>
    <div class="en-metrics en-admin-metrics">
      <Metric label="Matched" value={preview.matched} />
      <Metric label="Eligible" value={preview.eligible} />
      <Metric label="Storage" value={formatBytes(preview.bytes)} />
      {#if preview.skipped.total}<Metric label="Skipped" value={preview.skipped.total} />{/if}
    </div>
    <div id={sampleId}>
      {#if preview.sample.length}
        <Table rows={preview.sample} rowKey={(row) => `${row.kind}:${row.ref}`} columns={[
          ...(showOwner ? [{ header: 'Owner', cell: sampleOwner }] : []),
          { header: 'Name', cell: sampleName, className: 'name' },
          { header: 'Size', cell: sampleSize },
          { header: 'Last written', cell: sampleWritten },
          { header: 'Last read', cell: sampleRead },
          { header: 'Expiry', cell: sampleExpiry, className: 'when' },
        ]} />
      {:else}<EmptyState title="Nothing eligible">Narrow or widen the filters, then preview again.</EmptyState>{/if}
    </div>
    {#if preview.eligible > 0}
      <div class="en-admin-run en-admin-confirm"><Button id={confirmButtonId} variant={action === 'delete' ? 'danger' : 'primary'} disabled={busy} onclick={() => { confirmError = ''; confirmOpen = true; }}>{confirmAction}</Button></div>
    {/if}
  </Card>
{/if}
<ConfirmDialog id={confirmId} bind:open={confirmOpen} title={confirmAction} message={confirmMessage} label={`Type “${eligibleLabel}” to ${confirmAction.toLowerCase()}`} match={eligibleLabel} noun="count" action={confirmAction} danger={action === 'delete'} {busy} onConfirm={() => onConfirm()} error={confirmError} />
