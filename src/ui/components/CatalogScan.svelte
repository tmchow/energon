<script lang="ts">
  import Icon from './Icon.svelte';
  import type { IconName } from '../icons';

  export type CatalogScanMark = 'lock' | 'lockup' | 'people' | 'peopleOff';

  export const CATALOG_SCAN_LABEL: Record<CatalogScanMark, string> = {
    lock: 'View password',
    lockup: 'Write password',
    people: 'Org can write',
    peopleOff: 'Org cannot write',
  };

  const SCAN_SIZE = 28;

  let { mark, label, on = true, onclick }:
    { mark: CatalogScanMark; label?: string; on?: boolean; onclick?: () => void } = $props();

  const name = $derived(label ?? CATALOG_SCAN_LABEL[mark]);
  const iconName = $derived((mark === 'peopleOff' ? 'peopleOff' : mark) as IconName);
</script>
<button type="button" class="en-scan" class:en-scan--on={on} title={name} aria-label={name} {onclick}>
  <Icon name={iconName} size={SCAN_SIZE} />
</button>
