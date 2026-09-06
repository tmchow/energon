<script lang="ts">
  import Table from './Table.svelte';
  import CatalogScan, { type CatalogScanMark } from './CatalogScan.svelte';

  type Example = { name: string; note: string; marks: CatalogScanMark[] };

  const rows: Example[] = [
    { name: 'brief.md', note: 'View password only', marks: ['lock'] },
    { name: 'contractor.md', note: 'Write password', marks: ['lockup'] },
    { name: 'shared-board', note: 'Org can write', marks: ['people'] },
    { name: 'payroll.md', note: 'View password + org cannot write', marks: ['lock', 'peopleOff'] },
    { name: 'private-collab.md', note: 'Write password + org can write', marks: ['lockup', 'people'] },
  ];
</script>
{#snippet itemName(row: Example)}<span class="en-scan-example-name">{row.name}</span>{/snippet}
{#snippet marks(row: Example)}
  <div class="en-scan-pair">
    {#each row.marks as mark}
      <CatalogScan {mark} />
    {/each}
  </div>
{/snippet}
{#snippet note(row: Example)}<span class="en-scan-example-note">{row.note}</span>{/snippet}
<Table rows={rows} rowKey={row => row.name} columns={[
  { header: 'File', cell: itemName, className: 'name' },
  { header: 'Marks', cell: marks },
  { header: 'Meaning', cell: note, className: 'clip' },
]} />
