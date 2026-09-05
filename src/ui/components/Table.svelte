<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  let { columns, rows, rowKey, rowClassName, pager, className = '' }:
    { columns: { header?: string; key?: keyof T; cell?: Snippet<[T, number]>; className?: string }[];
      rows: T[]; rowKey: (row: T, index: number) => string | number; rowClassName?: (row: T) => string;
      pager?: Snippet; className?: string } = $props();
</script>
<div class="en-table-wrap"><table class="en-table {className}"><thead><tr>{#each columns.filter(c => c.className !== 'meta') as column}<th class={column.className} scope="col">{column.header || ''}</th>{/each}</tr></thead>
  <tbody>{#each rows as row, i (rowKey(row, i))}<tr class={rowClassName?.(row)}>{#each columns as column}<td class={column.className}>{#if column.cell}{@render column.cell(row, i)}{:else if column.key}{String(row[column.key] ?? '')}{/if}</td>{/each}</tr>{/each}</tbody>
</table></div>
{#if pager}<div class="en-pager">{@render pager()}</div>{/if}
