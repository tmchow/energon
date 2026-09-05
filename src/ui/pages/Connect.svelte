<script lang="ts">
  import { untrack } from 'svelte';
  import type { ConnectData } from '../types';
  import { api, jsonBody, errorMessage } from '../api';
  import CubeMark from '../components/CubeMark.svelte';
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
  const minutesLeft = Math.max(1, Math.round((Date.parse(data.connection.expires_at) - Date.now()) / 60000));
  async function decide(event: SubmitEvent) {
    event.preventDefault();
    if (busy || complete) return;
    const action = (event.submitter as HTMLButtonElement)?.value === 'deny' ? 'deny' : 'approve';
    busy = true; failed = false;
    try {
      await api(`/account/connections/${encodeURIComponent(data.connection.id)}/${action}`, jsonBody('POST', { user_code: code, ttl }));
      status = action === 'approve' ? 'Connection approved. Return to your agent; it has received its token.' : 'Connection denied. The agent has been told to stop.';
      complete = true;
    } catch (err) { status = errorMessage(err); failed = true; }
    finally { busy = false; }
  }
</script>
<main class="en-connect">
  <p class="en-connect-brand"><CubeMark size={26} /><span>Energon</span></p>
  <Card charged className="en-connect-card">
    <h1 class="en-connect-title">Connect your agent to <span class="en-connect-host">{data.host}</span></h1>
    <p class="en-connect-agent">Enter the code shown by <strong>{data.connection.label}</strong>.</p>
    {#if !complete}<form id="connect-form" class="en-connect-form" data-request={data.connection.id} onsubmit={decide}>
      <Field label="Code" htmlFor="connect-code"><input id="connect-code" class="en-input en-connect-code" name="user_code" bind:value={code} oninput={e => code = e.currentTarget.value.replace(/\D/g, '').slice(0, 8)} placeholder="00000000" inputmode="numeric" pattern={'[0-9]{8}'} maxlength="8" required autocomplete="one-time-code" spellcheck="false" disabled={busy} /></Field>
      <Field label="Access expires after" htmlFor="connect-ttl"><Select id="connect-ttl" name="ttl" bind:value={ttl} options={data.token_policy.presets.map(p => ({ value: p.id, label: p.label }))} disabled={busy} /></Field>
      <div class="en-connect-actions">
        <Button type="submit" value="approve" variant="primary" block disabled={busy || code.length !== 8}>{busy ? 'Approving…' : 'Approve connection'}</Button>
        <Button type="submit" value="deny" variant="ghost" block disabled={busy}>Deny connection</Button>
      </div>
    </form>{/if}
    <div id="connect-status" class="en-connect-status" aria-live="polite">{#if status}<Flash tone={failed ? 'err' : 'ok'}>{status}</Flash>{/if}</div>
    <p class="en-connect-meta">The agent will act as your account. It can read work on this instance, including password-protected links, and publish or update where you have permission. Approve only a code you asked for. This request expires in {minutesLeft} min.</p>
  </Card>
  <p class="en-connect-account">Signed in as <code>{data.email}</code> · <a href="/tokens">Manage tokens</a></p>
</main>
