<script lang="ts">
  import Icon from './Icon.svelte';
  import type { IconName } from '../icons';

  export type CatalogScanMark = 'lock' | 'lockup' | 'people' | 'peopleOff';
  export type CatalogScanSize = '19' | '24' | '28' | '32' | '36';

  let { mark, label, size = '24', on = true, onclick }:
    { mark: CatalogScanMark; label: string; size?: CatalogScanSize; on?: boolean; onclick?: () => void } = $props();

  const iconName = $derived((mark === 'peopleOff' ? 'peopleOff' : mark) as IconName);
  const glyph = $derived(Number(size));
</script>
<button type="button" class="en-scan en-scan--{size}" class:en-scan--on={on} title={label} aria-label={label} {onclick}>
  <Icon name={iconName} size={glyph} />
</button>
