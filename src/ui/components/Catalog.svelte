<script lang="ts">
  import type { CatalogItem } from '../types';
  import Timestamp from './Timestamp.svelte';
  import { formatBytes } from '../../config';
  import Table from './Table.svelte';
  import EmptyState from './EmptyState.svelte';
  import Badge from './Badge.svelte';
  import IconButton from './IconButton.svelte';
  import CopyButton from './CopyButton.svelte';
  import Button from './Button.svelte';
  import CatalogScan from './CatalogScan.svelte';
  import { CATALOG_SCAN_LABEL } from '../catalog-scan';
  let { kind, items, cursor, busy, allowUnlimited, writePolicyDefault, onMore, onPassword, onDelete, onLoadMore }:
    { kind: 'site' | 'file'; items: CatalogItem[]; cursor: string | null; busy: boolean; allowUnlimited: boolean;
      writePolicyDefault: string;
      onMore: (item: CatalogItem) => void; onPassword: (item: CatalogItem) => void; onDelete: (item: CatalogItem) => void; onLoadMore: () => void } = $props();
  const name = (item: CatalogItem) => item.slug ?? item.filename;
  const size = (item: CatalogItem) => formatBytes(item.size) + (kind === 'site' ? ` · ${item.file_count} ${item.file_count === 1 ? 'file' : 'files'}` : '');
  const orgMark = (item: CatalogItem) => item.write_policy === writePolicyDefault ? null : item.write_policy === 'instance' ? 'people' as const : 'peopleOff' as const;
  const passwordMark = (item: CatalogItem) => item.write_password_protected ? 'lockup' as const : item.password_protected ? 'lock' as const : null;
  const passwordLabel = (item: CatalogItem) => item.write_password_protected ? CATALOG_SCAN_LABEL.lockup : CATALOG_SCAN_LABEL.lock;
  const orgLabel = (item: CatalogItem) => item.write_policy === 'instance' ? CATALOG_SCAN_LABEL.people : CATALOG_SCAN_LABEL.peopleOff;
</script>
{#snippet itemName(item: CatalogItem)}<a href={item.url}>{name(item)}</a>{#if item.password_protected}<Badge tone="lock">password</Badge>{/if}{#if item.expires_at || allowUnlimited}<Badge tone="ttl"><Timestamp value={item.expires_at} dateOnly empty="Never" /></Badge>{/if}{/snippet}
{#snippet writer(item: CatalogItem)}{item.last_written_by || item.created_by}{#if item.written_via === 'write_password'} · Updated via shared write{/if}{/snippet}
{#snippet updated(item: CatalogItem)}<Timestamp value={item.updated_at || item.created_at} />{/snippet}
{#snippet itemSize(item: CatalogItem)}{size(item)}{/snippet}
{#snippet meta(item: CatalogItem)}<Timestamp value={item.updated_at || item.created_at} /> · {size(item)}{/snippet}
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
    {#if kind === 'file' || (item.file_count ?? 0) > 0}<IconButton icon="download" label={kind === 'site' ? 'Download zip' : 'Download'} extra href={kind === 'site' ? `/account/sites/${encodeURIComponent(item.slug ?? item.id)}/export` : `/account/files/${encodeURIComponent(item.id ?? item.slug)}/download`} />{/if}
    <CopyButton text={item.url} label="Copy URL" iconOnly />
    <IconButton icon="trash" label="Delete" tone="danger" extra onclick={() => onDelete(item)} />
    <IconButton icon="more" label="More actions" more onclick={() => onMore(item)} />
  </div>
{/snippet}
{#snippet pager()}<Button variant="ghost" size="sm" disabled={busy} onclick={onLoadMore}>{busy ? 'Loading…' : 'Load more'}</Button>{/snippet}
{#if items.length}<Table rows={items} rowKey={item => item.slug ?? item.id} pager={cursor ? pager : undefined}
  columns={[{ header: kind === 'site' ? 'Slug' : 'File', cell: itemName, className: 'name' }, { header: 'Created by', key: 'created_by', className: 'clip' }, { header: 'Last writer', cell: writer, className: 'clip' }, { header: 'Updated', cell: updated, className: 'when' }, { header: 'Size', cell: itemSize, className: 'num' }, { cell: meta, className: 'meta' }, { cell: actions, className: 'actions' }]} />
{:else if kind === 'site'}<EmptyState title="No sites yet">Publish a prepared folder or ask your agent to publish a prototype.</EmptyState>
{:else}<EmptyState title="No files yet">Upload a document or ask your agent to publish one, then share its link.</EmptyState>{/if}
