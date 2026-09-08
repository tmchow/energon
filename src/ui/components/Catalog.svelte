<script lang="ts">
  import type { CatalogItem } from '../types';
  import Timestamp from './Timestamp.svelte';
  import { formatBytes } from '../../config';
  import Table from './Table.svelte';
  import EmptyState from './EmptyState.svelte';
  import IconButton from './IconButton.svelte';
  import CopyButton from './CopyButton.svelte';
  import Button from './Button.svelte';
  import CatalogScan from './CatalogScan.svelte';
  import { CATALOG_SCAN_LABEL, CATALOG_ACTION_SIZE } from '../catalog-scan';
  let { kind, items, cursor, busy, filtered = false, writePolicyDefault, selected, onToggle, onToggleVisible, onMore, onPassword, onDelete, onLoadMore }:
    { kind: 'site' | 'file'; items: CatalogItem[]; cursor: string | null; busy: boolean; filtered?: boolean;
      writePolicyDefault: string;
      selected: (id: string) => boolean;
      onToggle: (item: CatalogItem, on: boolean) => void;
      onToggleVisible: (on: boolean) => void;
      onMore: (item: CatalogItem) => void; onPassword: (item: CatalogItem) => void; onDelete: (item: CatalogItem) => void; onLoadMore: () => void } = $props();
  const name = (item: CatalogItem) => item.slug ?? item.filename;
  const size = (item: CatalogItem) => formatBytes(item.size) + (kind === 'site' ? ` · ${item.file_count} ${item.file_count === 1 ? 'file' : 'files'}` : '');
  const orgMark = (item: CatalogItem) => item.write_policy === writePolicyDefault ? null : item.write_policy === 'org' ? 'people' as const : 'peopleOff' as const;
  const passwordMark = (item: CatalogItem) => item.write_password_protected ? 'lockup' as const : item.password_protected ? 'lock' as const : null;
  const passwordLabel = (item: CatalogItem) => item.write_password_protected ? CATALOG_SCAN_LABEL.lockup : CATALOG_SCAN_LABEL.lock;
  const orgLabel = (item: CatalogItem) => item.write_policy === 'org' ? CATALOG_SCAN_LABEL.people : CATALOG_SCAN_LABEL.peopleOff;
  const allVisible = $derived(items.length > 0 && items.every((item) => selected(item.id)));
</script>
{#snippet itemName(item: CatalogItem)}
  <input type="checkbox" class="en-check" id="catalog-select-{kind}-{item.id}" aria-label="Select {name(item)}" checked={selected(item.id)} onchange={(event) => onToggle(item, event.currentTarget.checked)} />
  <a href={item.url}>{name(item)}</a>
{/snippet}
{#snippet writer(item: CatalogItem)}{item.last_written_by || item.created_by}{#if item.written_via === 'write_password'} · Updated via shared write{/if}{/snippet}
{#snippet updated(item: CatalogItem)}<Timestamp value={item.updated_at || item.created_at} />{/snippet}
{#snippet expires(item: CatalogItem)}{#if item.expires_at}<Timestamp value={item.expires_at} />{/if}{/snippet}
{#snippet lastRead(item: CatalogItem)}<Timestamp value={item.last_read_at} empty="No recorded read" />{/snippet}
{#snippet itemSize(item: CatalogItem)}{size(item)}{/snippet}
{#snippet meta(item: CatalogItem)}<Timestamp value={item.updated_at || item.created_at} /> · {size(item)}{#if item.expires_at} · Expires <Timestamp value={item.expires_at} />{/if} · Last read <Timestamp value={item.last_read_at} empty="No recorded read" />{/snippet}
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
    {#if kind === 'file' || (item.file_count ?? 0) > 0}<IconButton icon="download" label={kind === 'site' ? 'Download zip' : 'Download'} extra iconSize={CATALOG_ACTION_SIZE} href={kind === 'site' ? `/account/sites/${encodeURIComponent(item.id)}/export` : `/account/files/${encodeURIComponent(item.id)}/download`} />{/if}
    <CopyButton text={item.url} label="Copy URL" iconOnly iconSize={CATALOG_ACTION_SIZE} />
    <IconButton icon="trash" label="Delete" tone="danger" extra iconSize={CATALOG_ACTION_SIZE} onclick={() => onDelete(item)} />
    <IconButton icon="more" label="More actions" more iconSize={CATALOG_ACTION_SIZE} onclick={() => onMore(item)} />
  </div>
{/snippet}
{#snippet pager()}
  <Button id="catalog-select-{kind === 'site' ? 'sites' : 'files'}" variant="ghost" size="sm" disabled={busy} onclick={() => onToggleVisible(!allVisible)}>{allVisible ? 'Clear visible' : 'Select visible'}</Button>
  {#if cursor}<Button variant="ghost" size="sm" disabled={busy} onclick={onLoadMore}>{busy ? 'Loading…' : 'Load more'}</Button>{/if}
{/snippet}
{#if items.length}<Table rows={items} rowKey={item => item.id} rowClassName={(item) => selected(item.id) ? 'row-selected' : ''} pager={pager}
  columns={[{ header: kind === 'site' ? 'Slug' : 'File', cell: itemName, className: 'name' }, { header: 'Last writer', cell: writer, className: 'clip' }, { header: 'Updated', cell: updated, className: 'when' }, { header: 'Last read', cell: lastRead, className: 'when' }, { header: 'Expires', cell: expires, className: 'when' }, { header: 'Size', cell: itemSize, className: 'num' }, { cell: meta, className: 'meta' }, { cell: actions, className: 'actions' }]} />
{:else if filtered}<EmptyState title={kind === 'site' ? 'No matching sites' : 'No matching files'}>Widen the search or filters.</EmptyState>
{:else if kind === 'site'}<EmptyState title="No sites yet">Publish a prepared folder or ask your agent to publish a prototype.</EmptyState>
{:else}<EmptyState title="No files yet">Upload a document or ask your agent to publish one, then share its link.</EmptyState>{/if}
