<script lang="ts">
  import Icon from './Icon.svelte';
  import type { IconName } from '../icons';
  import { CATALOG_SCAN_LABEL, CATALOG_SCAN_SIZE, type CatalogScanMark } from '../catalog-scan';

  let { mark, label, on = true, onclick }:
    { mark: CatalogScanMark; label?: string; on?: boolean; onclick?: () => void } = $props();

  const name = $derived(label ?? CATALOG_SCAN_LABEL[mark]);
  const iconName = $derived((mark === 'peopleOff' ? 'peopleOff' : mark) as IconName);
</script>
<button type="button" class="en-scan" class:en-scan--on={on} title={name} aria-label={name} {onclick}>
  <Icon name={iconName} size={CATALOG_SCAN_SIZE} />
</button>
