<script lang="ts">
  import { untrack } from 'svelte';
  import type { ConnectData } from '../types';
  import { api, jsonBody, errorMessage } from '../api';
  import PageTitle from '../components/PageTitle.svelte';
  import Card from '../components/Card.svelte';
  import Field from '../components/Field.svelte';
  import Select from '../components/Select.svelte';
  import Button from '../components/Button.svelte';
  import Flash from '../components/Flash.svelte';
  let { data }: { data: ConnectData } = $props();
  let code = $state('');
  let ttl = $state(untrack(() => data.token_policy.default));
  let busy = $state(false);
  let status = $state('');
  let failed = $state(false);
  let complete = $state(false);
  async function decide(event: SubmitEvent) {
    event.preventDefault();
    if (busy || complete) return;
    const action = (event.submitter as HTMLButtonElement)?.value === 'deny' ? 'deny' : 'approve';
    busy = true; failed = false;
    try {
      await api(`/account/connections/${encodeURIComponent(data.connection.id)}/${action}`, jsonBody('POST', { user_code: code, ttl }));
      status = action === 'approve' ? 'Connection approved. Return to your agent to finish connecting.' : 'Connection denied.';
      complete = true;
    } catch (err) { status = errorMessage(err); failed = true; }
    finally { busy = false; }
  }
</script>
<main class="en-wrap">
  <PageTitle title="Connect an agent"><p class="en-lede">Approve only a request you started with your agent. The agent supplied this label: <strong>{data.connection.label}</strong>.</p></PageTitle>
  <div class="en-connect"><Card>
    <p class="en-connect-copy">You are signed in as <strong>{data.email}</strong>. The agent will act as this account.</p>
    <p class="en-connect-copy">This token can read work on this instance, including password-protected files, and publish, update, or delete work where your account has permission. This grants the same access as a manually created token.</p>
    <p class="en-connect-instructions">Enter the code your agent showed you. Do not approve a code sent by someone else. This request expires at <span class="en-mono en-connect-expiry">{new Date(data.connection.expires_at).toUTCString()}</span>.</p>
    {#if !complete}<form id="connect-form" class="en-connect-form" data-request={data.connection.id} onsubmit={decide}>
      <Field label="Agent code" htmlFor="connect-code"><input id="connect-code" class="en-input en-connect-code" name="user_code" bind:value={code} oninput={e => code = e.currentTarget.value.replace(/\D/g, '')} placeholder="48213907" inputmode="numeric" pattern={'[0-9]{8}'} maxlength="8" required autocomplete="off" disabled={busy} /></Field>
      <Field label="Token lifetime" htmlFor="connect-ttl"><Select id="connect-ttl" name="ttl" bind:value={ttl} options={data.token_policy.presets.map(p => ({ value: p.id, label: p.label }))} disabled={busy} /></Field>
      <div class="en-connect-actions"><Button type="submit" value="approve" variant="primary" disabled={busy || code.length !== 8}>Approve connection</Button><Button type="submit" value="deny" disabled={busy}>Deny connection</Button></div>
    </form>{/if}
    <div id="connect-status" aria-live="polite">{#if status}<Flash tone={failed ? 'err' : 'ok'}>{status}</Flash>{/if}</div>
    <p class="en-muted en-connect-footer">You can revoke the token at <a href="/tokens">Tokens</a>. The secret goes directly to the waiting agent.</p>
  </Card></div>
</main>
