<script lang="ts">
  let { value, label, display = false }: { value: string | number; label: string; display?: boolean } = $props();
</script>
<div class="en-metric"><div class="en-metric-value" class:en-metric-value--display={display}>{value}</div><div class="en-metric-label">{label}</div></div>
