<script lang="ts">
  import type { CatalogItem } from '../types';
  import Timestamp from './Timestamp.svelte';
  import Badge from './Badge.svelte';
  import { formatBytes } from '../../config';
  import { expiryUrgency } from '../../expiry-windows';
  import Table from './Table.svelte';
  import EmptyState from './EmptyState.svelte';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';
  import CopyButton from './CopyButton.svelte';
  import Button from './Button.svelte';
  import CatalogScan from './CatalogScan.svelte';
  import { CATALOG_SCAN_LABEL, CATALOG_ACTION_SIZE } from '../catalog-scan';
  let { items, cursor, busy, filtered = false, kind = 'all', writePolicyDefault, selected, onToggle, onToggleVisible, onSelectMatching, onMore, onPassword, onDelete, onLoadMore }:
    { items: CatalogItem[]; cursor: string | null; busy: boolean; filtered?: boolean; kind?: 'all' | 'sites' | 'files';
      writePolicyDefault: string;
      selected: (item: CatalogItem) => boolean;
      onToggle: (item: CatalogItem, on: boolean) => void;
      onToggleVisible: (on: boolean) => void;
      onSelectMatching: () => void;
      onMore: (item: CatalogItem) => void; onPassword: (item: CatalogItem) => void; onDelete: (item: CatalogItem) => void; onLoadMore: () => void } = $props();
  const name = (item: CatalogItem) => item.slug ?? item.filename;
  const size = (item: CatalogItem) => formatBytes(item.size) + (item.kind === 'site' ? ` · ${item.file_count} ${item.file_count === 1 ? 'file' : 'files'}` : '');
  const orgMark = (item: CatalogItem) => item.write_policy === writePolicyDefault ? null : item.write_policy === 'org' ? 'people' as const : 'peopleOff' as const;
  const passwordMark = (item: CatalogItem) => item.write_password_protected ? 'lockup' as const : item.password_protected ? 'lock' as const : null;
  const passwordLabel = (item: CatalogItem) => item.write_password_protected ? CATALOG_SCAN_LABEL.lockup : CATALOG_SCAN_LABEL.lock;
  const orgLabel = (item: CatalogItem) => item.write_policy === 'org' ? CATALOG_SCAN_LABEL.people : CATALOG_SCAN_LABEL.peopleOff;
  const downloadHref = (item: CatalogItem) => item.kind === 'site' ? `/account/sites/${encodeURIComponent(item.id)}/export` : `/account/files/${encodeURIComponent(item.id)}/download`;
  const allVisible = $derived(items.length > 0 && items.every((item) => selected(item)));
  const noun = $derived(kind === 'sites' ? 'sites' : kind === 'files' ? 'files' : 'sites or files');
</script>
{#snippet itemName(item: CatalogItem)}
  <span class="en-catalog-name">
    <input type="checkbox" class="en-check" id="catalog-select-{item.kind}-{item.id}" aria-label="Select {name(item)}" checked={selected(item)} onchange={(event) => onToggle(item, event.currentTarget.checked)} />
    <Icon name={item.kind} size={16} title={item.kind === 'site' ? 'Site' : 'File'} className="en-catalog-kind" />
    <a href={item.url}>{name(item)}</a>
  </span>
{/snippet}
{#snippet updated(item: CatalogItem)}<Timestamp value={item.updated_at || item.created_at} />{/snippet}
{#snippet lastRead(item: CatalogItem)}<Timestamp value={item.last_read_at} empty="None" />{/snippet}
{#snippet expires(item: CatalogItem)}
  {#if item.expires_at}
    {@const tone = expiryUrgency(item.expires_at) ?? 'ttl'}
    <Badge {tone}><Timestamp value={item.expires_at} /></Badge>
  {/if}
{/snippet}
{#snippet itemSize(item: CatalogItem)}{size(item)}{/snippet}
{#snippet meta(item: CatalogItem)}
  <Timestamp value={item.updated_at || item.created_at} /> · {size(item)}
  {#if item.expires_at}
    {@const tone = expiryUrgency(item.expires_at) ?? 'ttl'}
    {' · Expires '}
    <Badge {tone}><Timestamp value={item.expires_at} /></Badge>
  {/if}
  {' · Last read '}
  <Timestamp value={item.last_read_at} empty="None" />
{/snippet}
{#snippet actions(item: CatalogItem)}
  <div class="en-row-actions">
    <div class="en-scan-pair">
      {#if passwordMark(item)}
        <CatalogScan mark={passwordMark(item)!} label={passwordLabel(item)} onclick={() => onPassword(item)} />
      {/if}
      {#if orgMark(item)}
        <CatalogScan mark={orgMark(item)!} label={orgLabel(item)} />
      {/if}
    </div>
    {#if item.kind === 'file' || (item.file_count ?? 0) > 0}<IconButton icon="download" label={item.kind === 'site' ? 'Download zip' : 'Download'} extra iconSize={CATALOG_ACTION_SIZE} href={downloadHref(item)} />{/if}
    <CopyButton text={item.url} label="Copy URL" iconOnly iconSize={CATALOG_ACTION_SIZE} />
    <IconButton icon="trash" label="Delete" tone="danger" extra iconSize={CATALOG_ACTION_SIZE} onclick={() => onDelete(item)} />
    <IconButton icon="more" label="More actions" more iconSize={CATALOG_ACTION_SIZE} onclick={() => onMore(item)} />
  </div>
{/snippet}
{#snippet pager()}
  <Button id="catalog-select-visible" variant="ghost" size="sm" disabled={busy} onclick={() => onToggleVisible(!allVisible)}>{allVisible ? 'Clear visible' : 'Select visible'}</Button>
  <Button id="catalog-select-matching" variant="ghost" size="sm" disabled={busy} onclick={onSelectMatching}>Select all matching these filters</Button>
  {#if cursor}<Button id="catalog-load-more" variant="ghost" size="sm" disabled={busy} onclick={onLoadMore}>{busy ? 'Loading…' : 'Load more'}</Button>{/if}
{/snippet}
{#if items.length}<Table rows={items} rowKey={item => `${item.kind}:${item.id}`} rowClassName={(item) => selected(item) ? 'row-selected' : ''} pager={pager}
  columns={[{ header: 'Name', cell: itemName, className: 'name' }, { header: 'Updated', cell: updated, className: 'when' }, { header: 'Last read', cell: lastRead, className: 'when' }, { header: 'Expires', cell: expires, className: 'when' }, { header: 'Size', cell: itemSize, className: 'num' }, { cell: meta, className: 'meta' }, { cell: actions, className: 'actions' }]} />
{:else if filtered}<EmptyState title="No matching {noun}">Widen the search or filters.</EmptyState>
{:else}<EmptyState title="Nothing published yet">Upload a document, publish a prepared folder, or ask your agent to publish for you.</EmptyState>{/if}
