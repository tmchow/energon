<script lang="ts">
  import type { AdminToken, BulkRevokePreview, BulkRevokeResult, BulkRevokeTarget, TokenStatus } from '../types';
  import { api, jsonBody, errorMessage, RequestError } from '../api';
  import Timestamp from './Timestamp.svelte';
  import Card from './Card.svelte';
  import Field from './Field.svelte';
  import Input from './Input.svelte';
  import SegmentedControl from './SegmentedControl.svelte';
  import Badge from './Badge.svelte';
  import Button from './Button.svelte';
  import Table from './Table.svelte';
  import Flash from './Flash.svelte';
  import EmptyState from './EmptyState.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  type Show = 'live' | 'stale' | 'all';
  const SHOWS: Record<Show, { statuses: TokenStatus[]; empty: string; hint: string }> = {
    live: { statuses: ['live', 'stale'], empty: 'No live tokens', hint: 'This owner has no live tokens, or list a different account.' },
    stale: { statuses: ['stale'], empty: 'No stale tokens', hint: 'Every live token for this owner was used in the last 30 days.' },
    all: { statuses: ['live', 'stale', 'expired', 'revoked'], empty: 'No tokens', hint: 'Nothing minted for this owner.' },
  };
  const ROW_CLASS: Record<TokenStatus, string> = { live: '', stale: 'row-stale', expired: 'expired row-expired', revoked: 'expired row-revoked' };
  let owner = $state('');
  let listedOwner = $state('');
  let tokens = $state<AdminToken[]>([]);
  let show = $state<Show>('live');
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);
  let bulk = $state<BulkRevokePreview | null>(null);
  let bulkOpen = $state(false);
  function count(status: TokenStatus) { return tokens.filter(t => t.status === status).length; }
  const staleCount = $derived(count('stale'));
  const liveCount = $derived(count('live') + staleCount);
  const revocable = $derived(tokens.length - count('revoked'));
  const visible = $derived(tokens.filter(t => SHOWS[show].statuses.includes(t.status)));
  const loaded = $derived(listedOwner !== '');
  const showOptions = $derived([
    { value: 'live', label: `Live (${liveCount})` },
    { value: 'stale', label: `Stale (${staleCount})` },
    { value: 'all', label: `All (${tokens.length})` },
  ]);
  const bulkTitle = $derived(bulk?.target === 'all' ? 'Revoke all tokens' : 'Revoke stale tokens');
  const bulkMatch = $derived(bulk ? `${bulk.matched} ${bulk.matched === 1 ? 'token' : 'tokens'}` : '');
  const bulkMessage = $derived.by(() => {
    if (!bulk) return '';
    const labels = bulk.sample.map(t => t.label).join(', ');
    const more = bulk.matched > bulk.sample.length ? ` and ${bulk.matched - bulk.sample.length} more` : '';
    const who = bulk.target === 'all' ? `Every token on ${listedOwner}` : `Every token unused for 30 days on ${listedOwner}`;
    return `${who} is revoked: ${labels}${more}. Agents using them will get 401. The token making this request stays live. Type the count to confirm.`;
  });
  async function refresh() {
    const listed = await api<{ tokens: AdminToken[] }>(`/account/admin/tokens?owner=${encodeURIComponent(listedOwner)}&limit=50`);
    tokens = listed.tokens;
  }
  async function load(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    const next = owner.trim();
    if (!next) return;
    busy = true; error = ''; notice = '';
    try {
      const listed = await api<{ tokens: AdminToken[] }>(`/account/admin/tokens?owner=${encodeURIComponent(next)}&limit=50`);
      listedOwner = next;
      tokens = listed.tokens;
    } catch (err) { error = errorMessage(err); }
    finally { busy = false; }
  }
  async function preview(which: BulkRevokeTarget) {
    if (busy || !listedOwner) return;
    busy = true; error = ''; notice = '';
    try {
      bulk = await api<BulkRevokePreview>('/account/admin/tokens/revoke', jsonBody('POST', { owner: listedOwner, target: which }));
      bulkOpen = true;
    } catch (err) { error = errorMessage(err); }
    finally { busy = false; }
  }
  async function revokeBulk() {
    if (!bulk || busy || !listedOwner) return;
    busy = true; error = '';
    try {
      const result = await api<BulkRevokeResult>('/account/admin/tokens/revoke', jsonBody('POST', { owner: listedOwner, target: bulk.target, confirm: bulk.confirm }));
      bulkOpen = false;
      notice = `Revoked ${result.revoked} ${result.revoked === 1 ? 'token' : 'tokens'}.`;
      await refresh();
    } catch (err) {
      if (err instanceof RequestError && err.status === 409) {
        bulk = await api<BulkRevokePreview>('/account/admin/tokens/revoke', jsonBody('POST', { owner: listedOwner, target: bulk.target })).catch(() => bulk);
        error = 'Those tokens changed since this preview. Review the new count and confirm again.';
      } else error = errorMessage(err);
    }
    finally { busy = false; }
  }
</script>

{#snippet tokenOwner(token: AdminToken)}{token.owner_handle || '—'} <span class="en-muted-copy">{token.owner_email}</span>{/snippet}
{#snippet tokenLabel(token: AdminToken)}{token.label}{#if token.scope === 'admin'}{' '}<Badge tone="warn">Admin</Badge>{/if}{/snippet}
{#snippet tokenHint(token: AdminToken)}<code>{token.hint || '—'}</code>{/snippet}
{#snippet created(token: AdminToken)}<Timestamp value={token.created_at} />{/snippet}
{#snippet lastUsed(token: AdminToken)}<Timestamp value={token.last_used_at} empty="never" />{#if token.status === 'stale'}{' '}<Badge tone="warn">Stale</Badge>{/if}{/snippet}
{#snippet expires(token: AdminToken)}{#if token.status === 'revoked'}Revoked{:else if token.status === 'expired'}Expired{:else}<Timestamp value={token.expires_at} dateOnly empty="Never" />{/if}{/snippet}
{#snippet tools()}
  <div class="en-toolbar en-tokens-tools">
    <SegmentedControl id="admin-tokens-show" ariaLabel="Show tokens" options={showOptions} bind:value={show} disabled={!loaded} />
    <Button id="admin-revoke-stale" size="sm" variant="danger" disabled={busy || !staleCount} onclick={() => preview('stale')}>Revoke stale</Button>
    <Button id="admin-revoke-all" size="sm" variant="danger" disabled={busy || !revocable} onclick={() => preview('all')}>Revoke all</Button>
  </div>
{/snippet}

<Card title="Tokens across accounts" className="en-admin-card" tight headEnd={tools}>
  <p class="en-muted-copy en-admin-note">Pick an owner, then revoke unused keys or every key on that account. Metadata only. The token making this request stays live.</p>
  <form id="admin-tokens-filters" class="en-form-stack" onsubmit={load}>
    <div class="en-admin-filters">
      <Field label="Owner" htmlFor="admin-tokens-owner" note="Handle or email">
        <Input id="admin-tokens-owner" bind:value={owner} mono placeholder="ada" disabled={busy} />
      </Field>
    </div>
    <div class="en-admin-run"><Button id="admin-tokens-list" type="submit" variant="primary" disabled={busy || !owner.trim()}>{busy && !bulkOpen ? 'Listing…' : 'List'}</Button></div>
  </form>
  <div id="admin-tokens-messages">{#if error}<Flash tone="err">{error}</Flash>{/if}{#if notice}<Flash tone="ok">{notice}</Flash>{/if}</div>
  <div id="admin-tokens-table">
    {#if loaded && visible.length}
      <Table rows={visible} rowKey={t => t.id} rowClassName={t => ROW_CLASS[t.status]}
        columns={[
          { header: 'Owner', cell: tokenOwner },
          { header: 'Label', cell: tokenLabel, className: 'name' },
          { header: 'Key', cell: tokenHint },
          { header: 'Created', cell: created },
          { header: 'Last used', cell: lastUsed },
          { header: 'Expires', cell: expires, className: 'when' },
        ]} />
    {:else if loaded}
      <EmptyState title={SHOWS[show].empty}>{SHOWS[show].hint}</EmptyState>
    {:else}
      <EmptyState title="No tokens listed">Enter a handle or email, then list.</EmptyState>
    {/if}
  </div>
</Card>
<ConfirmDialog id="admin-tokens-dlg" bind:open={bulkOpen} title={bulkTitle} message={bulkMessage} label={`Type “${bulkMatch}” to revoke`} match={bulkMatch} noun="count" action="Revoke" danger {busy} onConfirm={revokeBulk} {error} />
