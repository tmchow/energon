<script lang="ts">
  let { units = 3, direction = 'h', reverse = false, still = false, length = '100%', duration = '2.8s', className = '' }:
    { units?: number; direction?: 'h' | 'v'; reverse?: boolean; still?: boolean; length?: number | string; duration?: string; className?: string } = $props();
  const measure = $derived(typeof length === 'number' ? `${length}px` : length);
</script>
<span class="en-conduit {className}" class:en-conduit--v={direction === 'v'} class:en-conduit--reverse={reverse} class:en-conduit--still={still}
  style:width={direction === 'h' ? measure : undefined} style:height={direction === 'v' ? measure : undefined} style:--dur-flow={duration} aria-hidden="true">
  {#each Array.from({ length: units }) as _}<i></i>{/each}
</span>
