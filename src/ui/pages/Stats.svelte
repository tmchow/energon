<script lang="ts">
  import type { StatsPayload } from '../../page-data';
  import { formatBytes, formatCount } from '../../config';
  import PageTitle from '../components/PageTitle.svelte';
  import Card from '../components/Card.svelte';
  import Metric from '../components/Metric.svelte';
  import ProgressBar from '../components/ProgressBar.svelte';
  import SegmentedControl from '../components/SegmentedControl.svelte';
  let { data }: { data: StatsPayload } = $props();
  let sort = $state('storage');
  const key = $derived(sort === 'files' ? 'files' : sort === 'sites' ? 'sites' : 'bytes');
  const people = $derived([...data.people].sort((a, b) => b[key] - a[key] || a.handle.localeCompare(b.handle)));
  const max = $derived(Math.max(0, ...people.map(p => p[key])));
  const hint = $derived(sort === 'files' ? 'Most files first.' : sort === 'sites' ? 'Most sites first.' : 'Largest storage first.');
</script>
<main class="en-wrap">
  <PageTitle kicker="How much is here" title="Storage and usage." wide lede="Your numbers cover work you created or last updated. Organization covers this instance. Files includes individual uploads and files inside sites. These are stored-content totals, not counts of views or handoffs." />
  <div class="en-grid-2 en-stats-grid">
    {#each [{ title: 'You', sub: data.email, bucket: data.you }, { title: 'Organization', sub: `${formatCount(data.system.people)} ${data.system.people === 1 ? 'person' : 'people'}`, bucket: data.system }] as pane}
      <Card className="en-stats-pane"><h2>{pane.title}</h2><p class="en-stats-sub">{pane.sub}</p><div class="en-metrics"><Metric label="Sites" value={formatCount(pane.bucket.sites)} /><Metric label="Files" value={formatCount(pane.bucket.files)} /><Metric label="Storage" value={formatBytes(pane.bucket.bytes)} /></div></Card>
    {/each}
  </div>
  <Card id="people" className="en-people-card">
    <div class="en-people-heading"><div><h2>People</h2><p id="people-hint" class="en-stats-sub">{people.length ? hint : 'No one has published yet.'}</p></div>
      {#if people.length}<SegmentedControl bind:value={sort} ariaLabel="Rank people by" options={[{ value: 'storage', label: 'Storage' }, { value: 'files', label: 'Files' }, { value: 'sites', label: 'Sites' }]} />{/if}
    </div>
    <ol class="en-people">{#each people as person, i (person.email)}
      <li class="en-person" class:en-person--you={person.email === data.email} data-bytes={person.bytes} data-files={person.files} data-sites={person.sites}>
        <div class="en-person-rank" aria-hidden="true">{i + 1}</div><div class="en-person-who"><strong>{person.handle}</strong><span>{person.email}</span></div>
        <div class="en-person-val">{key === 'bytes' ? formatBytes(person.bytes) : formatCount(person[key])}</div><ProgressBar value={person[key]} {max} />
      </li>
    {/each}</ol>
  </Card>
</main>
