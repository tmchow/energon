<script lang="ts">
  import type { AdminHealthSnapshot } from '../types';
  import { formatBytes, formatCount } from '../../config';
  import Card from './Card.svelte';
  import Metric from './Metric.svelte';
  import ProgressBar from './ProgressBar.svelte';
  let { health }: { health: AdminHealthSnapshot } = $props();
</script>
<Card id="admin-health" title="Health" hint="Read-only." className="en-admin-card en-admin-health">
  <p class="en-muted-copy">Quota used is the ledger that stops publishes when it reaches the cap. Catalog is stored sizes. Expired objects wait for the next sweep. Stale purge claims are markers older than a minute.</p>
  <div class="en-metrics" id="admin-health-quota">
    <div id="admin-health-used"><Metric label="Quota used" value={formatBytes(health.quota.used_bytes)} /></div>
    <div id="admin-health-cap"><Metric label="Cap" value={formatBytes(health.quota.limit_bytes)} /></div>
    <div id="admin-health-catalog"><Metric label="Catalog" value={formatBytes(health.quota.catalog_bytes)} /></div>
  </div>
  <ProgressBar value={health.quota.used_bytes} max={health.quota.limit_bytes} label="Quota used" />
  <div class="en-metrics">
    <div id="admin-health-expired"><Metric label="Expired awaiting purge" value={formatCount(health.expired_awaiting_purge)} /></div>
    <div id="admin-health-stale"><Metric label="Stale purge claims" value={formatCount(health.stale_purge_claims)} /></div>
    <div id="admin-health-locked"><Metric label="Locked share gates" value={formatCount(health.locked_gates)} /></div>
  </div>
  <div class="en-metrics">
    <div id="admin-health-sites"><Metric label="Sites" value={formatCount(health.sites)} /></div>
    <div id="admin-health-files"><Metric label="Files" value={formatCount(health.files)} /></div>
    <div id="admin-health-people"><Metric label="People" value={formatCount(health.people)} /></div>
  </div>
  {#if health.locked_scopes.length}
    <ul id="admin-health-scopes" class="en-admin-health-scopes">{#each health.locked_scopes as scope (scope)}<li><code>{scope}</code></li>{/each}</ul>
  {/if}
</Card>
