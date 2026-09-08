<script lang="ts">
  import { untrack } from 'svelte';
  import type { TokensData, Token, CatalogData, TokenStatus, BulkRevokePreview, BulkRevokeResult, BulkRevokeTarget } from '../types';
  import { api, jsonBody, errorMessage, RequestError } from '../api';
  import Timestamp from '../components/Timestamp.svelte';
  import PageTitle from '../components/PageTitle.svelte';
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
  import TokenReveal from '../components/TokenReveal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  type Show = 'live' | 'stale' | 'all';
  const SHOWS: Record<Show, { statuses: TokenStatus[]; empty: string; hint: string }> = {
    live: { statuses: ['live', 'stale'], empty: 'No live tokens', hint: 'Set up your agent and approve its code, or mint one below for CI.' },
    stale: { statuses: ['stale'], empty: 'No stale tokens', hint: 'Every live token was used in the last 30 days.' },
    all: { statuses: ['live', 'stale', 'expired', 'revoked'], empty: 'No tokens', hint: 'Set up your agent and approve its code, or mint one below for CI.' },
  };
  const ROW_CLASS: Record<TokenStatus, string> = { live: '', stale: 'row-stale', expired: 'expired row-expired', revoked: 'expired row-revoked' };
  let { data }: { data: TokensData } = $props();
  let tokens = $state(untrack(() => data.tokens));
  let show = $state<Show>('live');
  let label = $state('');
  let scope = $state<'account' | 'admin'>('account');
  let ttl = $state(untrack(() => data.token_policy.default));
  let minted = $state('');
  let error = $state('');
  let mintError = $state('');
  let notice = $state('');
  let pageError = $state('');
  let busy = $state(false);
  let target = $state<Token | null>(null);
  let confirmOpen = $state(false);
  let bulk = $state<BulkRevokePreview | null>(null);
  let bulkOpen = $state(false);
  const accountOptions = $derived(data.token_policy.presets.map(p => ({ value: p.id, label: p.label })));
  const adminOptions = $derived((data.admin_token_policy?.presets || []).map(p => ({ value: p.id, label: p.label })));
  const options = $derived(scope === 'admin' ? adminOptions : accountOptions);
  function setScope(next: string) {
    scope = next === 'admin' ? 'admin' : 'account';
    ttl = scope === 'admin' ? (data.admin_token_policy?.default || '1d') : data.token_policy.default;
  }
  function count(status: TokenStatus) { return tokens.filter(t => t.status === status).length; }
  const staleCount = $derived(count('stale'));
  const liveCount = $derived(count('live') + staleCount);
  const revocable = $derived(tokens.length - count('revoked'));
  const visible = $derived(tokens.filter(t => SHOWS[show].statuses.includes(t.status)));
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
    const who = bulk.target === 'all' ? 'Every token on your account' : 'Every token unused for 30 days';
    return `${who} is revoked: ${labels}${more}. Agents using them will get 401. Type the count to confirm.`;
  });
  function expiry(token: Token) {
    if (!token.expires_at) return '';
    const days = Math.ceil((Date.parse(token.expires_at) - data.now) / 86400000);
    return days <= 1 ? '<1 day' : `${days} days`;
  }
  async function refresh() { tokens = (await api<CatalogData>('/account/data')).tokens || []; }
  async function mint(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true; mintError = ''; minted = ''; notice = '';
    try {
      const result = await api<{ token: string }>('/account/tokens', jsonBody('POST', { label, ttl, scope: data.admin ? scope : undefined }));
      minted = result.token; label = ''; ttl = scope === 'admin' ? (data.admin_token_policy?.default || '1d') : data.token_policy.default;
      await refresh();
    } catch (err) { mintError = errorMessage(err); }
    finally { busy = false; }
  }
  async function revoke() {
    if (!target || busy) return;
    busy = true; error = '';
    try {
      await api(`/account/tokens/${encodeURIComponent(target.id)}/revoke`, { method: 'POST' });
      minted = ''; confirmOpen = false;
      await refresh();
    } catch (err) { error = errorMessage(err); }
    finally { busy = false; }
  }
  async function preview(which: BulkRevokeTarget) {
    if (busy) return;
    busy = true; error = ''; notice = ''; pageError = '';
    try {
      bulk = await api<BulkRevokePreview>('/account/tokens/revoke', jsonBody('POST', { target: which }));
      bulkOpen = true;
    } catch (err) { pageError = errorMessage(err); }
    finally { busy = false; }
  }
  async function revokeBulk() {
    if (!bulk || busy) return;
    busy = true; error = ''; pageError = '';
    try {
      const result = await api<BulkRevokeResult>('/account/tokens/revoke', jsonBody('POST', { target: bulk.target, confirm: bulk.confirm }));
      minted = ''; bulkOpen = false;
      notice = `Revoked ${result.revoked} ${result.revoked === 1 ? 'token' : 'tokens'}.`;
      await refresh();
    } catch (err) {
      if (err instanceof RequestError && err.status === 409) {
        bulk = await api<BulkRevokePreview>('/account/tokens/revoke', jsonBody('POST', { target: bulk.target })).catch(() => bulk);
        error = 'Your tokens changed since this preview. Review the new count and confirm again.';
      } else error = errorMessage(err);
    }
    finally { busy = false; }
  }
</script>

{#snippet tokenHint(token: Token)}<code>{token.hint || '—'}</code>{#if token.admin}{' '}<Badge>Admin</Badge>{/if}{/snippet}
{#snippet created(token: Token)}<Timestamp value={token.created_at} />{/snippet}
{#snippet lastUsed(token: Token)}<Timestamp value={token.last_used_at} empty="never" />{#if token.status === 'stale'}{' '}<Badge tone="warn">Stale</Badge>{/if}{/snippet}
{#snippet expires(token: Token)}{#if token.status === 'revoked'}Revoked{:else if token.status === 'expired'}Expired{:else}<Timestamp value={token.expires_at} dateOnly empty="Never" />{#if token.expires_at}{' '}({expiry(token)}){/if}{/if}{/snippet}
{#snippet meta(token: Token)}{token.hint || '—'} · {@render expires(token)}{/snippet}
{#snippet actions(token: Token)}{#if token.status !== 'revoked'}<Button size="sm" variant="danger" onclick={() => { target = token; error = ''; confirmOpen = true; }}>Revoke</Button>{/if}{/snippet}
{#snippet tools()}
  <div class="en-toolbar en-tokens-tools">
    <SegmentedControl id="tokens-show" ariaLabel="Show tokens" options={showOptions} bind:value={show} />
    <Button id="revoke-stale" size="sm" variant="danger" disabled={busy || !staleCount} onclick={() => preview('stale')}>Revoke stale</Button>
    <Button id="revoke-all" size="sm" variant="danger" disabled={busy || !revocable} onclick={() => preview('all')}>Revoke all</Button>
  </div>
{/snippet}
<main class="en-wrap">
  <PageTitle title="Agent tokens" wide>
    <p class="en-lede">Each token is an agent acting as you: it can publish, read, reference, or update work, including password-protected links, subject to each file or site's write policy. Revoke one here to cut that agent off. Expiry stops the agent, not the links it published.</p>
    <p class="en-lede">You usually do not mint tokens here. <a href="/setup">Set up your agent</a> and it provisions its own token when you approve its code. Mint one by hand only for CI, scheduled jobs, or a hosted sandbox with a secret store.</p>
  </PageTitle>
  <div id="messages">{#if mintError}<Flash tone="err">{mintError}</Flash>{/if}{#if pageError}<Flash tone="err">{pageError}</Flash>{/if}{#if notice}<Flash tone="ok">{notice}</Flash>{/if}</div>
  <Card title="Tokens" headEnd={tools} tight className="en-tokens-card">
    <p class="en-muted-copy en-tokens-note">Stale means unused for 30 days. Live hides expired and revoked tokens; All shows every token you have minted. Last four characters shown.</p>
    <div id="tokens">
      {#if visible.length}<Table rows={visible} rowKey={t => t.id} rowClassName={t => ROW_CLASS[t.status]}
        columns={[{ header: 'Label', key: 'label', className: 'name' }, { header: 'Key', cell: tokenHint }, { header: 'Created', cell: created }, { header: 'Last used', cell: lastUsed }, { header: 'Expires', cell: expires, className: 'when' }, { className: 'meta', cell: meta }, { cell: actions, className: 'actions' }]} />
      {:else}<EmptyState title={SHOWS[show].empty}>{SHOWS[show].hint}</EmptyState>{/if}
    </div>
  </Card>
  <Card title="Mint a token by hand" hint="For CI and unattended runs" className="en-tokens-card">
    <p class="en-muted-copy">Store the secret as <code>{data.token_env}</code> in that environment's secret store. It is shown once.</p>
    <form id="mint" class="en-mint" onsubmit={mint}>
      <Field label="Label" htmlFor="mint-label"><Input id="mint-label" name="label" bind:value={label} placeholder="ci" required maxlength={64} disabled={busy} /></Field>
      {#if data.admin}<Field label="Scope" htmlFor="mint-scope"><SegmentedControl id="mint-scope" bind:value={scope} ariaLabel="Token scope" onChange={setScope} options={[{ value: 'account', label: 'Account' }, { value: 'admin', label: 'Admin' }]} /></Field>{/if}
      <Field label="Lifetime" htmlFor="mint-ttl"><Select id="mint-ttl" name="ttl" aria-label="Token lifetime" bind:value={ttl} {options} disabled={busy} /></Field>
      <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Minting…' : 'Mint token'}</Button>
    </form>
    <p class="en-note" id="mint-ttl-note" hidden={scope === 'admin' || data.token_policy.allow_never}>This Energon does not allow never-expiring tokens.</p>
    <p class="en-note" id="mint-admin-note" hidden={scope !== 'admin'}>Admin tokens last at most 7 days and still act as your account for ordinary API calls. The connect flow cannot mint them.</p>
    <div id="new-token">{#if minted}<TokenReveal token={minted} tokenEnv={data.token_env} />{/if}</div>
  </Card>
</main>
<ConfirmDialog bind:open={confirmOpen} title="Revoke token" message="Agents using this key will get 401. Type the label to confirm." label={`Type “${target?.label || ''}” to revoke`} match={target?.label} action="Revoke" danger {busy} onConfirm={revoke} {error} />
<ConfirmDialog id="bulk-dlg" bind:open={bulkOpen} title={bulkTitle} message={bulkMessage} label={`Type “${bulkMatch}” to revoke`} match={bulkMatch} noun="count" action="Revoke" danger {busy} onConfirm={revokeBulk} {error} />
