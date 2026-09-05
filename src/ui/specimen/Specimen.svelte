<script lang="ts">
  import AppHeader from '../components/AppHeader.svelte';
  import AppFooter from '../components/AppFooter.svelte';
  import PageTitle from '../components/PageTitle.svelte';
  import Card from '../components/Card.svelte';
  import Button from '../components/Button.svelte';
  import IconButton from '../components/IconButton.svelte';
  import Field from '../components/Field.svelte';
  import Input from '../components/Input.svelte';
  import Select from '../components/Select.svelte';
  import SegmentedControl from '../components/SegmentedControl.svelte';
  import UrlField from '../components/UrlField.svelte';
  import PasswordField from '../components/PasswordField.svelte';
  import Badge from '../components/Badge.svelte';
  import Metric from '../components/Metric.svelte';
  import ProgressBar from '../components/ProgressBar.svelte';
  import CopyRow from '../components/CopyRow.svelte';
  import CopyBlock from '../components/CopyBlock.svelte';
  import Table from '../components/Table.svelte';
  import EmptyState from '../components/EmptyState.svelte';
  import Flash from '../components/Flash.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import Sheet from '../components/Sheet.svelte';
  import DropZone from '../components/DropZone.svelte';
  import Flow from '../components/Flow.svelte';
  let theme = $state('dark');
  let scope = $state('Your work');
  let slug = $state('project-brief');
  let password = $state('');
  let confirm = $state(false);
  let sheet = $state(false);
  let notice = $state('Published');
  const rows = [{ name: 'brief.md', size: '2 KB' }, { name: 'prototype', size: '18 KB' }];
  $effect(() => { document.documentElement.dataset.theme = theme; });
</script>
<AppHeader publicPage>{#snippet end()}<SegmentedControl bind:value={theme} options={['dark', 'light']} ariaLabel="Preview theme" />{/snippet}</AppHeader>
<main class="en-wrap">
  <PageTitle kicker="Component specimen" title="Energon design system" lede="Local component states. These examples do not call the application API." />
  <div class="en-stack en-section">
    <Card title="Actions" charged><div class="specimen-row">{#each (['primary', 'secondary', 'ghost', 'outline', 'danger'] as const) as variant}<Button {variant} onclick={() => notice = `${variant} action`}>{variant}</Button>{/each}<Button disabled>Disabled</Button><Button loading>Working</Button><IconButton icon="lock" label="Password protection" on /></div></Card>
    <Card title="Fields"><div class="en-grid-2"><Field label="Label" htmlFor="spec-label"><Input id="spec-label" placeholder="laptop" /></Field><Field label="Lifetime" htmlFor="spec-ttl"><Select id="spec-ttl" options={['1 day', '3 months', 'Never']} value="3 months" /></Field><Field label="Site URL" htmlFor="spec-slug"><UrlField id="spec-slug" prefix="/you/s/" suffix="/" bind:value={slug} /></Field><Field label="Share password" htmlFor="spec-password"><PasswordField id="spec-password" bind:value={password} words={['cube', 'violet', 'river', 'paper', 'spark']} /></Field></div><div class="en-section"><SegmentedControl bind:value={scope} options={['Your work', 'Created by you', 'Last edited by you']} ariaLabel="Catalog scope" /></div></Card>
    <Card title="Data"><div class="specimen-row"><Badge tone="lock">password</Badge><Badge tone="ttl">Never</Badge><Metric value="24" label="Files" /><Metric value="6.2 MB" label="Storage" /></div><ProgressBar value={62} label="Storage preview" /><Table {rows} rowKey={row => row.name} columns={[{ header: 'Name', key: 'name', className: 'name' }, { header: 'Size', key: 'size' }]} /><CopyRow label="Origin" value="https://energon.example.com" /><CopyBlock text="Read the project brief, then update the same link." /></Card>
    <Card title="Feedback"><div class="en-stack"><Flash>{notice}</Flash><Flash tone="warn">This link expires in one day.</Flash><Flash tone="err">That password is wrong.</Flash><EmptyState title="No files yet">Upload a document, then share its link.</EmptyState><div class="specimen-row"><Button onclick={() => confirm = true}>Delete confirmation</Button><Button onclick={() => sheet = true}>More actions</Button></div></div></Card>
    <Card title="Publishing" tight><DropZone onFiles={() => notice = 'Choose files'} onFolder={() => notice = 'Choose folder'} /></Card>
    <Card title="Conduits"><Flow nodes={[{ label: 'Agent', icon: 'terminal' }, { label: 'Energon', charged: true }, { label: 'Document', icon: 'clipboard' }]} /></Card>
  </div>
</main>
<AppFooter text="Energon · local specimen" />
<ConfirmDialog bind:open={confirm} title="Delete file" message="Type the name to confirm." label="Type brief.md to delete" match="brief.md" action="Delete" danger onConfirm={() => { confirm = false; notice = 'Example deleted'; }} />
<Sheet bind:open={sheet} title="brief.md" items={[{ label: 'Duplicate', icon: 'fork', onClick: () => notice = 'Example duplicated' }, { label: 'Delete', icon: 'trash', danger: true, onClick: () => confirm = true }]} />
<style>.specimen-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 16px; }</style>
