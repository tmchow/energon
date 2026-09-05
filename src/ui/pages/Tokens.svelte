<script lang="ts">
  import { untrack } from 'svelte';
  import type { TokensData, Token, CatalogData } from '../types';
  import { api, jsonBody, errorMessage } from '../api';
  import Timestamp from '../components/Timestamp.svelte';
  import PageTitle from '../components/PageTitle.svelte';
  import Card from '../components/Card.svelte';
  import Field from '../components/Field.svelte';
  import Input from '../components/Input.svelte';
  import Select from '../components/Select.svelte';
  import Button from '../components/Button.svelte';
  import Table from '../components/Table.svelte';
  import Flash from '../components/Flash.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import TokenReveal from '../components/TokenReveal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  let { data }: { data: TokensData } = $props();
  let tokens = $state(untrack(() => data.tokens));
  let label = $state('');
  let ttl = $state(untrack(() => data.token_policy.default));
  let minted = $state('');
  let error = $state('');
  let busy = $state(false);
  let target = $state<Token | null>(null);
  let confirmOpen = $state(false);
  const options = $derived(data.token_policy.presets.map(p => ({ value: p.id, label: p.label })));
  const active = $derived(tokens.filter(t => !t.revoked));
  function expiry(token: Token) {
    if (!token.expires_at) return '';
    const days = Math.ceil((Date.parse(token.expires_at) - data.now) / 86400000);
    return days <= 1 ? '<1 day' : `${days} days`;
  }
  async function refresh() { tokens = (await api<CatalogData>('/account/data')).tokens || []; }
  async function mint(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true; error = ''; minted = '';
    try {
      const result = await api<{ token: string }>('/account/tokens', jsonBody('POST', { label, ttl }));
      minted = result.token; label = ''; ttl = data.token_policy.default;
      await refresh();
    } catch (err) { error = errorMessage(err); }
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
</script>

{#snippet tokenHint(token: Token)}<code>{token.hint || '—'}</code>{/snippet}
{#snippet created(token: Token)}<Timestamp value={token.created_at} />{/snippet}
{#snippet lastUsed(token: Token)}<Timestamp value={token.last_used_at} empty="never" />{/snippet}
{#snippet expires(token: Token)}{#if token.expired}Expired{:else}<Timestamp value={token.expires_at} dateOnly empty="Never" />{#if token.expires_at}{' '}({expiry(token)}){/if}{/if}{/snippet}
{#snippet meta(token: Token)}{token.hint || '—'} · {@render expires(token)}{/snippet}
{#snippet actions(token: Token)}<Button size="sm" variant="danger" onclick={() => { target = token; confirmOpen = true; }}>Revoke</Button>{/snippet}
<main class="en-wrap">
  <PageTitle title="Agent tokens" wide>
    <p class="en-lede">Each token is an agent acting as you: it can publish, read, reference, or update work, including password-protected links, subject to each file or site's write policy. Revoke one here to cut that agent off. Expiry stops the agent, not the links it published.</p>
    <p class="en-lede">You usually do not mint tokens here. <a href="/setup">Set up your agent</a> and it provisions its own token when you approve its code. Mint one by hand only for CI, scheduled jobs, or a hosted sandbox with a secret store.</p>
  </PageTitle>
  <div id="messages">{#if error}<Flash tone="err">{error}</Flash>{/if}</div>
  <Card title="Active tokens" hint="Last four characters shown" tight className="en-tokens-card">
    <div id="tokens">
      {#if active.length}<Table rows={active} rowKey={t => t.id} rowClassName={t => t.expired ? 'expired row-expired' : ''}
        columns={[{ header: 'Label', key: 'label', className: 'name' }, { header: 'Key', cell: tokenHint }, { header: 'Created', cell: created }, { header: 'Last used', cell: lastUsed }, { header: 'Expires', cell: expires, className: 'when' }, { className: 'meta', cell: meta }, { cell: actions, className: 'actions' }]} />
      {:else}<EmptyState title="No active tokens">Set up your agent and approve its code, or mint one below for CI.</EmptyState>{/if}
    </div>
  </Card>
  <Card title="Mint a token by hand" hint="For CI and unattended runs" className="en-tokens-card">
    <p class="en-muted-copy">Store the secret as <code>{data.token_env}</code> in that environment's secret store. It is shown once.</p>
    <form id="mint" class="en-mint" onsubmit={mint}>
      <Field label="Label" htmlFor="mint-label"><Input id="mint-label" name="label" bind:value={label} placeholder="ci" required maxlength={64} disabled={busy} /></Field>
      <Field label="Lifetime" htmlFor="mint-ttl"><Select id="mint-ttl" name="ttl" aria-label="Token lifetime" bind:value={ttl} {options} disabled={busy} /></Field>
      <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Minting…' : 'Mint token'}</Button>
    </form>
    <p class="en-note" id="mint-ttl-note" hidden={data.token_policy.allow_never}>This instance does not allow never-expiring tokens.</p>
    <div id="new-token">{#if minted}<TokenReveal token={minted} tokenEnv={data.token_env} />{/if}</div>
  </Card>
</main>
<ConfirmDialog bind:open={confirmOpen} title="Revoke token" message="Agents using this key will get 401. Type the label to confirm." label={`Type “${target?.label || ''}” to revoke`} match={target?.label} action="Revoke" danger {busy} onConfirm={revoke} {error} />
