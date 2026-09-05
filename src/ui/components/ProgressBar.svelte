<script lang="ts">
  let { value = 0, max = 100, label }: { value?: number; max?: number; label?: string } = $props();
  const percent = $derived(max > 0 ? Math.max(0, Math.min(100, value / max * 100)) : 0);
</script>
<div class="en-bar" role={label ? 'meter' : undefined} aria-label={label} aria-valuenow={label ? value : undefined} aria-valuemin={label ? 0 : undefined} aria-valuemax={label ? max : undefined} aria-hidden={label ? undefined : true}><i style:width="{percent}%"></i></div>
