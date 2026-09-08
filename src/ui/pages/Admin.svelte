<script lang="ts">
  import { untrack } from 'svelte';
  import type { AdminAuditEvent, AdminData, AdminSample, CleanupPreview, CleanupResult } from '../types';
  import { api, errorMessage, jsonBody, RequestError } from '../api';
  import { formatBytes } from '../../config';
  import PageTitle from '../components/PageTitle.svelte';
  import Card from '../components/Card.svelte';
  import Field from '../components/Field.svelte';
  import Input from '../components/Input.svelte';
  import Select from '../components/Select.svelte';
  import SegmentedControl from '../components/SegmentedControl.svelte';
  import Button from '../components/Button.svelte';
  import Table from '../components/Table.svelte';
  import Flash from '../components/Flash.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import Timestamp from '../components/Timestamp.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  let { data }: { data: AdminData } = $props();
  let q = $state('');
  let owner = $state('');
  let kind = $state('both');
  let expires = $state('any');
  let expiresBefore = $state('');
  let updatedBefore = $state('');
  let readBefore = $state('');
  let minSize = $state('');
  let action = $state<'delete' | 'set_ttl' | 'expire'>('set_ttl');
  let ttl = $state(untrack(() => data.default_ttl));
  let preview = $state<CleanupPreview | null>(null);
  let events = $state<AdminAuditEvent[]>(untrack(() => data.audit));
  let auditTotal = $state(untrack(() => data.audit_total));
  let auditCursor = $state<string | null>(untrack(() => data.audit_cursor));
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let confirmOpen = $state(false);
  let confirmError = $state('');
  const ttlOptions = $derived(data.policy.presets.map(p => ({ value: p.id, label: p.label })));
  const confirmMatch = $derived(preview ? String(preview.eligible) : '');
  const confirmAction = $derived(action === 'delete' ? 'Delete' : action === 'expire' ? 'Expire' : 'Set expiry');
  const confirmMessage = $derived(preview
    ? `${confirmAction} ${preview.eligible} ${preview.eligible === 1 ? 'object' : 'objects'} (${formatBytes(preview.bytes)}). Type the eligible count to confirm.`
    : '');
  function targetBody(): Record<string, unknown> {
    const target: Record<string, unknown> = {};
    if (q.trim()) target.q = q.trim();
    if (owner.trim()) target.owner = owner.trim();
    if (kind === 'sites' || kind === 'files') target.kind = kind;
    if (expires === 'never') target.expires = 'never';
    if (expiresBefore.trim()) target.expires_before = expiresBefore.trim();
    if (updatedBefore.trim()) target.updated_before = updatedBefore.trim();
    if (readBefore.trim()) target.read_before = readBefore.trim();
    if (minSize.trim()) target.min_size = minSize.trim();
    return target;
  }
  function requestBody(confirm?: string): Record<string, unknown> {
    const body: Record<string, unknown> = { target: targetBody(), action };
    if (action === 'set_ttl') body.ttl = ttl;
    if (confirm) body.confirm = confirm;
    return body;
  }
  async function loadAudit(append = false) {
    const query = new URLSearchParams();
    if (append && auditCursor) query.set('cursor', auditCursor);
    const page = await api<{ events: AdminAuditEvent[]; total: number; next_cursor: string | null }>(`/account/admin/audit${query.size ? `?${query}` : ''}`);
    events = append ? [...events, ...page.events] : page.events;
    auditTotal = page.total;
    auditCursor = page.next_cursor;
  }
  async function runPreview() {
    if (busy) return;
    busy = true; error = ''; notice = ''; preview = null;
    try {
      preview = await api<CleanupPreview>('/account/admin/cleanup', jsonBody('POST', requestBody()));
    } catch (err) { error = errorMessage(err); }
    finally { busy = false; }
  }
  async function runConfirm() {
    if (!preview || busy) return;
    busy = true; confirmError = ''; error = '';
    try {
      const applied = await api<CleanupResult>('/account/admin/cleanup', jsonBody('POST', requestBody(preview.confirm)));
      confirmOpen = false;
      notice = action === 'delete'
        ? `Deleted ${applied.applied.total}.`
        : `Set expiry on ${applied.applied.total}.`;
      preview = null;
      await loadAudit();
    } catch (err) {
      if (err instanceof RequestError && err.status === 409) {
        preview = await api<CleanupPreview>('/account/admin/cleanup', jsonBody('POST', requestBody())).catch(() => preview);
        confirmError = 'The selection changed since that preview. Review the list and confirm again.';
      } else confirmError = errorMessage(err);
    } finally { busy = false; }
  }
</script>

{#snippet nameCell(row: AdminSample)}<strong>{row.name}</strong><span class="en-admin-kind">{row.kind}</span>{/snippet}
{#snippet writtenCell(row: AdminSample)}<Timestamp value={row.updated_at} />{/snippet}
{#snippet readCell(row: AdminSample)}<Timestamp value={row.last_read_at} empty="No recorded read" />{/snippet}
{#snippet expiryCell(row: AdminSample)}<Timestamp value={row.expires_at} dateOnly empty="Never" />{/snippet}
{#snippet sizeCell(row: AdminSample)}{formatBytes(row.bytes)}{/snippet}
{#snippet auditWhen(row: AdminAuditEvent)}<Timestamp value={row.at} />{/snippet}
{#snippet auditTarget(row: AdminAuditEvent)}<code class="en-admin-target">{JSON.stringify(row.target)}</code>{/snippet}
{#snippet auditCounts(row: AdminAuditEvent)}{row.applied} applied · {row.skipped} skipped · {row.failed} failed{/snippet}

<main class="en-wrap">
  <PageTitle kicker="This Energon" title="Retire old work." wide>
    <p class="en-lede">Find sites and files across every account, even when nobody set an expiry. Preview first. The safe default on someone else's content is a seven-day deadline so their catalog shows Expires and they can push it back. Deleting is the explicit choice. Last read is a floor. It can lag real reads by about a day plus an hourly throttle.</p>
  </PageTitle>
  <div id="admin-messages">{#if error}<Flash tone="err">{error}</Flash>{/if}{#if notice}<Flash tone="ok">{notice}</Flash>{/if}</div>
  <Card title="Filters" charged className="en-admin-card">
    <form id="admin-filters" class="en-form-stack" onsubmit={(event) => { event.preventDefault(); runPreview(); }}>
      <div class="en-admin-filters">
        <Field label="Name contains" htmlFor="admin-q"><Input id="admin-q" bind:value={q} disabled={busy} /></Field>
        <Field label="Owner" htmlFor="admin-owner" note="created_by email"><Input id="admin-owner" bind:value={owner} mono disabled={busy} /></Field>
        <Field label="Kind"><SegmentedControl id="admin-kind" bind:value={kind} ariaLabel="Kind" options={[{ value: 'both', label: 'Both' }, { value: 'sites', label: 'Sites' }, { value: 'files', label: 'Files' }]} /></Field>
        <Field label="Expiry"><SegmentedControl id="admin-expires" bind:value={expires} ariaLabel="Expiry filter" options={[{ value: 'any', label: 'Any' }, { value: 'never', label: 'Never' }]} /></Field>
        <Field label="Written before" htmlFor="admin-updated-before"><Input id="admin-updated-before" bind:value={updatedBefore} placeholder="2026-01-01T00:00:00Z" mono disabled={busy} /></Field>
        <Field label="No recorded read since" htmlFor="admin-read-before" note="last_read_at is a floor, not proof nobody opened it."><Input id="admin-read-before" bind:value={readBefore} placeholder="2026-01-01T00:00:00Z" mono disabled={busy} /></Field>
        <Field label="Expires before" htmlFor="admin-expires-before"><Input id="admin-expires-before" bind:value={expiresBefore} placeholder="2026-01-01T00:00:00Z" mono disabled={busy} /></Field>
        <Field label="Minimum size" htmlFor="admin-min-size"><Input id="admin-min-size" bind:value={minSize} placeholder="1mb" disabled={busy} /></Field>
      </div>
      <div class="en-admin-actions">
        <Field label="Action"><SegmentedControl id="admin-action" bind:value={action} ariaLabel="Cleanup action" options={[{ value: 'set_ttl', label: 'Set expiry' }, { value: 'expire', label: 'Expire' }, { value: 'delete', label: 'Delete' }]} /></Field>
        {#if action === 'set_ttl'}<Field label="Deadline" htmlFor="admin-ttl"><Select id="admin-ttl" bind:value={ttl} options={ttlOptions} disabled={busy} /></Field>{/if}
        <Button id="admin-preview" type="submit" variant="primary" disabled={busy}>{busy && !confirmOpen ? 'Previewing…' : 'Preview'}</Button>
      </div>
      <p class="en-note" id="admin-action-note">Expire is only for content you own. On someone else's content, set a deadline they can extend from the hub. Delete has no recycle bin.</p>
    </form>
  </Card>
  <Card title="Preview" tight className="en-admin-card" id="admin-sample">
    <p class="en-muted-copy" id="admin-preview-note">Columns: Owner, Name, Size, Last written, Last read, Expires. Last read is a floor.</p>
    {#if preview}
      <p class="en-muted-copy">{preview.eligible} eligible of {preview.matched} matched · {formatBytes(preview.bytes)}{#if preview.skipped.total} · {preview.skipped.total} skipped{/if}{#if preview.ttl} · {preview.ttl}{/if}</p>
      {#if preview.sample.length}
        <Table rows={preview.sample} rowKey={(row) => `${row.kind}:${row.ref}`}
          columns={[
            { header: 'Owner', key: 'owner' },
            { header: 'Name', cell: nameCell, className: 'name' },
            { header: 'Size', cell: sizeCell },
            { header: 'Last written', cell: writtenCell },
            { header: 'Last read', cell: readCell },
            { header: 'Expires', cell: expiryCell, className: 'when' },
          ]} />
      {:else}<EmptyState title="Nothing eligible">Narrow or widen the filters, then preview again.</EmptyState>{/if}
      <div class="en-admin-actions">
        <Button id="admin-confirm" variant={action === 'delete' ? 'danger' : 'primary'} disabled={busy || preview.eligible === 0} onclick={() => { confirmError = ''; confirmOpen = true; }}>{confirmAction}</Button>
      </div>
    {:else}<EmptyState title="No preview yet">Set filters and preview. Nothing changes until you confirm.</EmptyState>{/if}
  </Card>
  <Card title="Audit log" tight className="en-admin-card" id="admin-audit">
    <p class="en-muted-copy">{auditTotal ? `${auditTotal} recorded ${auditTotal === 1 ? 'action' : 'actions'}.` : 'No operator actions recorded yet.'} Metadata only. Never bytes or secrets.</p>
    {#if events.length}
      <Table rows={events} rowKey={(row) => row.id}
        columns={[
          { header: 'When', cell: auditWhen, className: 'when' },
          { header: 'Who', key: 'actor_email' },
          { header: 'Action', key: 'action' },
          { header: 'Target', cell: auditTarget },
          { header: 'Result', cell: auditCounts },
        ]} />
      {#if auditCursor}<div class="en-admin-actions"><Button id="admin-audit-more" size="sm" disabled={busy} onclick={() => loadAudit(true)}>Load more</Button></div>{/if}
    {:else}<EmptyState title="Empty log">Confirmed cleanups appear here.</EmptyState>{/if}
  </Card>
</main>
<ConfirmDialog id="admin-confirm-dlg" bind:open={confirmOpen} title={confirmAction} message={confirmMessage} label={`Type “${confirmMatch}” to ${confirmAction.toLowerCase()}`} match={confirmMatch} noun="count" action={confirmAction} danger={action === 'delete'} {busy} onConfirm={runConfirm} error={confirmError} />
