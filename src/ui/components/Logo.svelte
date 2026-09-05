<script lang="ts">
  import CubeMark from './CubeMark.svelte';
  let { size = 32, name = true, breathe = true, display = false, href = '/', id }:
    { size?: number; name?: boolean; breathe?: boolean; display?: boolean; href?: string; id?: string } = $props();
</script>
<a class="en-brand" {href} aria-label="Energon">
  <span class="en-mark" class:en-mark--breathe={breathe} style:--mark-size="{size}px"><CubeMark {size} {id} /></span>
  {#if name}<span class="en-brand-name" class:en-brand-name--display={display}>Energon</span>{/if}
</a>
