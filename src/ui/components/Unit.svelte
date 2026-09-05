<script lang="ts">
  let { dim = false, size = 6 }: { dim?: boolean; size?: number } = $props();
</script>
<i class="en-unit" class:en-unit--dim={dim} style:width="{size}px" style:height="{size}px" aria-hidden="true"></i>
