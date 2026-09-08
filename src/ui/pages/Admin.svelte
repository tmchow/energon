<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { AdminAuditEvent, AdminCleanupPreview, AdminCleanupResult, AdminData } from '../types';
  import { api, jsonBody, errorMessage, RequestError } from '../api';
  import { formatBytes } from '../../config';
  import PageTitle from '../components/PageTitle.svelte';
  import AdminTokens from '../components/AdminTokens.svelte';
  import Card from '../components/Card.svelte';
  import Field from '../components/Field.svelte';
  import Input from '../components/Input.svelte';
  import Select from '../components/Select.svelte';
  import SegmentedControl from '../components/SegmentedControl.svelte';
  import Badge from '../components/Badge.svelte';
  import Button from '../components/Button.svelte';
  import Table from '../components/Table.svelte';
  import Flash from '../components/Flash.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import Timestamp from '../components/Timestamp.svelte';
  import Metric from '../components/Metric.svelte';
  type Action = 'set_ttl' | 'delete' | 'expire';
  type Kind = 'both' | 'sites' | 'files';
  type Expires = 'any' | 'never';
  let { data }: { data: AdminData } = $props();
  let owner = $state('');
  let q = $state('');
  let createdBy = $state('');
  let lastReadBefore = $state('');
  let updatedBefore = $state('');
  let minSize = $state('');
  let kind = $state<Kind>('both');
  let expires = $state<Expires>('any');
  let action = $state<Action>('set_ttl');
  let ttl = $state(untrack(() => data.policy.presets.some(p => p.id === '7d') ? '7d' : ''));
  let preview = $state<AdminCleanupPreview | null>(null);
  let result = $state<AdminCleanupResult | null>(null);
  let events = $state<AdminAuditEvent[]>([]);
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);
  let confirmOpen = $state(false);
  let confirmError = $state('');
  const ttlOptions = $derived(data.policy.presets.map(p => ({ value: p.id, label: p.label })));
  const ownFilter = $derived(owner.trim().toLowerCase() === data.handle.trim().toLowerCase());
  const actionOptions = $derived([
    { value: 'set_ttl', label: 'Set expiry' },
    { value: 'delete', label: 'Delete' },
    ...(ownFilter ? [{ value: 'expire', label: 'Expire soon' }] : []),
  ]);
  const actionNote = $derived(ownFilter
    ? 'Set expiry is the safe default: the owner sees Expires and can push it back. Expire soon is only for your own work.'
    : 'Set expiry is the safe default: the owner sees Expires and can push it back.');
  $effect(() => { if (!ownFilter && action === 'expire') action = 'set_ttl'; });
  const eligibleLabel = $derived(preview ? `${preview.eligible} ${preview.eligible === 1 ? 'object' : 'objects'}` : '');
  const confirmAction = $derived(action === 'delete' ? 'Delete' : action === 'expire' ? 'Expire' : 'Set expiry');
  const confirmMessage = $derived(action === 'delete'
    ? `There is no recycle bin. ${eligibleLabel} will be removed. Type the count to confirm.`
    : action === 'expire'
      ? `${eligibleLabel} you own will get a 30-minute grace. Type the count to confirm.`
      : `${eligibleLabel} will expire in ${preview?.ttl || '7d'}. The owner sees Expires and can push it back. Type the count to confirm.`);
  function targetBody(): Record<string, unknown> {
    const target: Record<string, unknown> = {};
    if (q.trim()) target.q = q.trim();
    if (owner.trim()) target.owner = owner.trim();
    if (createdBy.trim()) target.created_by = createdBy.trim();
    if (lastReadBefore.trim()) target.last_read_before = lastReadBefore.trim();
    if (updatedBefore.trim()) target.updated_before = updatedBefore.trim();
    if (minSize.trim()) target.min_size = minSize.trim();
    if (expires === 'never') target.expires = 'never';
    if (kind !== 'both') target.kind = kind;
    return target;
  }
  function requestBody(confirm?: string): Record<string, unknown> {
    const body: Record<string, unknown> = { target: targetBody(), action };
    if (action === 'set_ttl' && ttl) body.ttl = ttl;
    if (confirm) body.confirm = confirm;
    return body;
  }
  async function loadAudit() {
    const listed = await api<{ events: AdminAuditEvent[] }>('/account/admin/audit');
    events = listed.events;
  }
  onMount(() => { loadAudit().catch(err => { error = errorMessage(err); }); });
  async function runPreview() {
    if (busy) return;
    busy = true; error = ''; notice = ''; result = null; confirmError = '';
    try {
      preview = await api<AdminCleanupPreview>('/account/admin/cleanup', jsonBody('POST', requestBody()));
    } catch (err) { preview = null; error = errorMessage(err); }
    finally { busy = false; }
  }
  async function runConfirm() {
    if (!preview || busy) return;
    busy = true; confirmError = ''; error = '';
    try {
      result = await api<AdminCleanupResult>('/account/admin/cleanup', jsonBody('POST', requestBody(preview.confirm)));
      confirmOpen = false;
      preview = null;
      notice = result.action === 'delete'
        ? `Deleted ${result.applied.total} ${result.applied.total === 1 ? 'object' : 'objects'}.`
        : `Set expiry on ${result.applied.total} ${result.applied.total === 1 ? 'object' : 'objects'}.`;
      await loadAudit();
    } catch (err) {
      if (err instanceof RequestError && err.status === 409) {
        preview = await api<AdminCleanupPreview>('/account/admin/cleanup', jsonBody('POST', requestBody())).catch(() => preview);
        confirmError = 'The selection changed since this preview. Review the new count and confirm again.';
      } else confirmError = errorMessage(err);
    } finally { busy = false; }
  }
</script>

{#snippet sampleOwner(row: AdminCleanupPreview['sample'][number])}{row.owner || '—'}{/snippet}
{#snippet sampleName(row: AdminCleanupPreview['sample'][number])}{row.name}{/snippet}
{#snippet sampleSize(row: AdminCleanupPreview['sample'][number])}{formatBytes(row.bytes)}{/snippet}
{#snippet sampleWritten(row: AdminCleanupPreview['sample'][number])}<Timestamp value={row.updated_at} />{/snippet}
{#snippet sampleRead(row: AdminCleanupPreview['sample'][number])}<Timestamp value={row.last_read_at} empty="No recorded read" />{/snippet}
{#snippet sampleExpiry(row: AdminCleanupPreview['sample'][number])}<Timestamp value={row.expires_at} dateOnly empty="" />{/snippet}
{#snippet auditWhen(event: AdminAuditEvent)}<Timestamp value={event.created_at} />{/snippet}
{#snippet auditWho(event: AdminAuditEvent)}{event.actor_email}{/snippet}
{#snippet auditToken(event: AdminAuditEvent)}<code>{event.token_hint || '—'}</code>{/snippet}
{#snippet auditWhat(event: AdminAuditEvent)}{event.action_kind || event.action}{#if event.ttl}{' '}{event.ttl}{/if}{' '}<Badge tone={event.executed ? 'ok' : 'warn'}>{event.executed ? 'Executed' : 'Preview'}</Badge>{/snippet}
{#snippet auditFilters(event: AdminAuditEvent)}<code>{JSON.stringify(event.target)}</code>{/snippet}
{#snippet auditCounts(event: AdminAuditEvent)}{event.executed ? `${event.applied ?? 0} applied` : `${event.eligible ?? 0} eligible`}{#if event.bytes != null}{' · '}{formatBytes(event.bytes)}{/if}{/snippet}

<main class="en-wrap">
  <PageTitle kicker="This Energon" title="Retire old work." wide>
    <p class="en-lede">Set a short expiry on sites and files nobody marked, across every account. The owner sees Expires in their catalog and can push it back. Deleting is an explicit choice. Every preview and execute is recorded.</p>
  </PageTitle>
  <div id="admin-messages">{#if error}<Flash tone="err">{error}</Flash>{/if}{#if notice}<Flash tone="ok">{notice}</Flash>{/if}</div>
  <Card title="Find work" className="en-admin-card" charged>
    <form id="admin-filters" class="en-form-stack" onsubmit={(event) => { event.preventDefault(); runPreview(); }}>
      <div class="en-admin-filters">
        <Field label="Owner" htmlFor="admin-owner" note="Handle, not email"><Input id="admin-owner" bind:value={owner} mono placeholder="ada" disabled={busy} /></Field>
        <Field label="Name contains" htmlFor="admin-q"><Input id="admin-q" bind:value={q} placeholder="old-notes" disabled={busy} /></Field>
        <Field label="Created by" htmlFor="admin-created-by"><Input id="admin-created-by" bind:value={createdBy} mono placeholder="ada@esperlabs.app" disabled={busy} /></Field>
        <Field label="Last read before" htmlFor="admin-last-read" note="ISO timestamp. Matches work with no recorded read too. Reads lag up to about a day."><Input id="admin-last-read" bind:value={lastReadBefore} mono placeholder="2026-01-01" disabled={busy} /></Field>
        <Field label="Last written before" htmlFor="admin-updated-before"><Input id="admin-updated-before" bind:value={updatedBefore} mono placeholder="2026-01-01" disabled={busy} /></Field>
        <Field label="Minimum size" htmlFor="admin-min-size"><Input id="admin-min-size" bind:value={minSize} placeholder="1mb" disabled={busy} /></Field>
      </div>
      <Field label="Kind"><SegmentedControl id="admin-kind" ariaLabel="Object kind" options={[{ value: 'both', label: 'Sites and files' }, { value: 'sites', label: 'Sites' }, { value: 'files', label: 'Files' }]} bind:value={kind} disabled={busy} /></Field>
      <Field label="Expiry"><SegmentedControl id="admin-expires" ariaLabel="Expiry filter" options={[{ value: 'any', label: 'Any' }, { value: 'never', label: 'Never expires' }]} bind:value={expires} disabled={busy} /></Field>
      <Field label="Action" note={actionNote}>
        <SegmentedControl id="admin-action" ariaLabel="Cleanup action" options={actionOptions} bind:value={action} disabled={busy} />
      </Field>
      {#if action === 'set_ttl'}
        <Field label="New expiry" htmlFor="admin-ttl" note="Defaults to 7 days.">
          <Select id="admin-ttl" name="ttl" aria-label="New expiry" bind:value={ttl} options={[{ value: '', label: '7 days (default)' }, ...ttlOptions]} disabled={busy} />
        </Field>
      {/if}
      <div class="en-admin-run"><Button id="admin-preview" type="submit" variant="primary" disabled={busy}>{busy && !confirmOpen ? 'Previewing…' : 'Preview'}</Button></div>
    </form>
  </Card>
  {#if preview}
    <Card title="Preview" className="en-admin-card" tight>
      <div class="en-metrics en-admin-metrics">
        <Metric label="Matched" value={preview.matched} />
        <Metric label="Eligible" value={preview.eligible} />
        <Metric label="Storage" value={formatBytes(preview.bytes)} />
        {#if preview.skipped.total}<Metric label="Skipped" value={preview.skipped.total} />{/if}
      </div>
      <div id="admin-sample">
        {#if preview.sample.length}
          <Table rows={preview.sample} rowKey={(row) => `${row.kind}:${row.ref}`} columns={[
            { header: 'Owner', cell: sampleOwner },
            { header: 'Name', cell: sampleName, className: 'name' },
            { header: 'Size', cell: sampleSize },
            { header: 'Last written', cell: sampleWritten },
            { header: 'Last read', cell: sampleRead },
            { header: 'Expiry', cell: sampleExpiry, className: 'when' },
          ]} />
        {:else}<EmptyState title="Nothing eligible">Narrow or widen the filters, then preview again.</EmptyState>{/if}
      </div>
      {#if preview.eligible > 0}
        <div class="en-admin-run en-admin-confirm"><Button id="admin-confirm" variant={action === 'delete' ? 'danger' : 'primary'} disabled={busy} onclick={() => { confirmError = ''; confirmOpen = true; }}>{confirmAction}</Button></div>
      {/if}
    </Card>
  {/if}
  <AdminTokens />
  <Card title="Audit" className="en-admin-card" tight>
    <p class="en-muted-copy en-admin-note">Who, which token, what, which filters, how many, when. Metadata only.</p>
    <div id="admin-audit">
      {#if events.length}
        <Table rows={events} rowKey={(event) => event.id} columns={[
          { header: 'When', cell: auditWhen },
          { header: 'Who', cell: auditWho },
          { header: 'Token', cell: auditToken },
          { header: 'Action', cell: auditWhat },
          { header: 'Filters', cell: auditFilters },
          { header: 'Counts', cell: auditCounts },
        ]} />
      {:else}<EmptyState title="No admin actions yet">Previews and executes land here.</EmptyState>{/if}
    </div>
  </Card>
</main>
<ConfirmDialog id="admin-dlg" bind:open={confirmOpen} title={confirmAction} message={confirmMessage} label={`Type “${eligibleLabel}” to ${confirmAction.toLowerCase()}`} match={eligibleLabel} noun="count" action={confirmAction} danger={action === 'delete'} {busy} onConfirm={runConfirm} error={confirmError} />
