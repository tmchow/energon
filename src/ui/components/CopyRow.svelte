<script lang="ts">
  import CopyButton from './CopyButton.svelte';
  let { label, value }: { label: string; value: string } = $props();
</script>
<div class="en-copy-row"><div><div class="en-copy-row-label">{label}</div><code>{value}</code></div><CopyButton text={value} /></div>
