<script lang="ts">
  import Icon from './Icon.svelte';
  import type { IconName } from '../icons';

  export type CatalogScanMark = 'lock' | 'lockup' | 'people' | 'peopleOff';
  export type CatalogScanSize = 'cramped' | 'pad8' | 'pad12' | 'glyph32';

  let { mark, label, size = 'pad8', on = true, onclick }:
    { mark: CatalogScanMark; label: string; size?: CatalogScanSize; on?: boolean; onclick?: () => void } = $props();

  const iconName = $derived((mark === 'peopleOff' ? 'peopleOff' : mark) as IconName);
</script>
<button type="button" class="en-scan en-scan--{size}" class:en-scan--on={on} title={label} aria-label={label} {onclick}>
  <Icon name={iconName} size={size === 'glyph32' ? 32 : 36} />
</button>
