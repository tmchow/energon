<script lang="ts">
  import type { AdminHealthSnapshot, GateUnlockResult, QuotaRecomputeResult, SweepNowResult } from '../types';
  import { api, errorMessage, jsonBody } from '../api';
  import { formatBytes, formatCount } from '../../config';
  import Card from './Card.svelte';
  import Metric from './Metric.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import Button from './Button.svelte';
  import Field from './Field.svelte';
  import Input from './Input.svelte';
  import Flash from './Flash.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  let { health }: { health: AdminHealthSnapshot } = $props();
  let snapshot = $state<AdminHealthSnapshot | null>(null);
  let scope = $state('');
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let recomputeOpen = $state(false);
  let sweepOpen = $state(false);
  const view = $derived(snapshot ?? health);
  const sweepLabel = $derived(view.expired_awaiting_purge > 0
    ? `${formatCount(view.expired_awaiting_purge)} left, run again`
    : 'Sweep now');
  async function refresh() {
    snapshot = await api<AdminHealthSnapshot>('/account/admin/health');
  }
  async function runRecompute() {
    if (busy) return;
    busy = true; error = ''; notice = '';
    try {
      const result = await api<QuotaRecomputeResult>('/account/admin/quota/recompute', jsonBody('POST', {}));
      notice = `Quota used was ${formatBytes(result.used_before)}, now ${formatBytes(result.used_after)}.`;
      recomputeOpen = false;
      await refresh();
    } catch (err) { error = errorMessage(err); }
    finally { busy = false; }
  }
  async function runSweep() {
    if (busy) return;
    busy = true; error = ''; notice = '';
    try {
      const result = await api<SweepNowResult>('/account/admin/sweep', jsonBody('POST', {}));
      const swept = result.swept.sites + result.swept.files;
      notice = result.expired_remaining > 0
        ? `Swept ${formatCount(swept)}. ${formatCount(result.expired_remaining)} left, run again.`
        : `Swept ${formatCount(swept)}. None left.`;
      sweepOpen = false;
      await refresh();
    } catch (err) { error = errorMessage(err); }
    finally { busy = false; }
  }
  async function runUnlock() {
    if (busy || !scope.trim()) return;
    busy = true; error = ''; notice = '';
    try {
      const result = await api<GateUnlockResult>('/account/admin/gates/unlock', jsonBody('POST', { scope: scope.trim() }));
      notice = result.unlocked ? `Unlocked ${result.scope}.` : `No locked row for ${result.scope}.`;
      await refresh();
    } catch (err) { error = errorMessage(err); }
    finally { busy = false; }
  }
</script>
<Card id="admin-health" title="Health" className="en-admin-card en-admin-health">
  <p class="en-muted-copy">Quota used is the ledger that stops publishes when it reaches the cap. Catalog is stored sizes. Expired objects wait for the next sweep. Stale purge claims are markers older than a minute. Recompute and sweep do not delete live work.</p>
  {#if error}<Flash tone="err">{error}</Flash>{/if}
  {#if notice}<Flash tone="ok">{notice}</Flash>{/if}
  <div class="en-metrics" id="admin-health-quota">
    <div id="admin-health-used"><Metric label="Quota used" value={formatBytes(view.quota.used_bytes)} /></div>
    <div id="admin-health-cap"><Metric label="Cap" value={formatBytes(view.quota.limit_bytes)} /></div>
    <div id="admin-health-catalog"><Metric label="Catalog" value={formatBytes(view.quota.catalog_bytes)} /></div>
  </div>
  <ProgressBar value={view.quota.used_bytes} max={view.quota.limit_bytes} label="Quota used" />
  <div class="en-metrics">
    <div id="admin-health-expired"><Metric label="Expired awaiting purge" value={formatCount(view.expired_awaiting_purge)} /></div>
    <div id="admin-health-stale"><Metric label="Stale purge claims" value={formatCount(view.stale_purge_claims)} /></div>
    <div id="admin-health-locked"><Metric label="Locked share gates" value={formatCount(view.locked_gates)} /></div>
  </div>
  <div class="en-metrics">
    <div id="admin-health-sites"><Metric label="Sites" value={formatCount(view.sites)} /></div>
    <div id="admin-health-files"><Metric label="Files" value={formatCount(view.files)} /></div>
    <div id="admin-health-people"><Metric label="People" value={formatCount(view.people)} /></div>
  </div>
  {#if view.locked_scopes.length}
    <ul id="admin-health-scopes" class="en-admin-health-scopes">{#each view.locked_scopes as locked (locked)}
      <li><button type="button" class="en-admin-health-scope" onclick={() => scope = locked}><code>{locked}</code></button></li>
    {/each}</ul>
  {/if}
  <div class="en-admin-health-run">
    <Button id="admin-health-recompute" disabled={busy} onclick={() => { error = ''; recomputeOpen = true; }}>Recompute quota</Button>
    <Button id="admin-health-sweep" disabled={busy} onclick={() => { error = ''; sweepOpen = true; }}>{sweepLabel}</Button>
  </div>
  <form class="en-admin-health-unlock" onsubmit={(event) => { event.preventDefault(); runUnlock(); }}>
    <Field label="Share gate scope" htmlFor="admin-health-scope" note="obj:/handle/f/id/, ip:, or the matching write scopes.">
      <Input id="admin-health-scope" bind:value={scope} mono disabled={busy} />
    </Field>
    <Button id="admin-health-unlock" type="submit" disabled={busy || !scope.trim()}>Unlock</Button>
  </form>
</Card>
<ConfirmDialog id="admin-health-recompute-dlg" bind:open={recomputeOpen} title="Recompute quota" message="This sets the ledger from stored sizes. It does not delete content." action="Recompute" {busy} onConfirm={runRecompute} />
<ConfirmDialog id="admin-health-sweep-dlg" bind:open={sweepOpen} title="Sweep expired" message="This runs one expiry sweep of at most 100 objects. Already-expired work is removed. Remaining expired objects can be swept again." action="Sweep" {busy} onConfirm={runSweep} />
