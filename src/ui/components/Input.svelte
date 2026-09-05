<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  let { value = $bindable(''), mono = false, size = 'lg', class: className = '', ...rest }:
    Omit<HTMLInputAttributes, 'size' | 'value'> & { value?: string; mono?: boolean; size?: 'md' | 'lg' } = $props();
</script>
<input {...rest} bind:value class="en-input en-input--{size} {className}" class:en-input--mono={mono} />
