<script lang="ts">
  import type { HTMLSelectAttributes } from 'svelte/elements';
  let { options, value = $bindable(''), ...rest }:
    Omit<HTMLSelectAttributes, 'value'> & { value?: string; options: (string | { value: string; label: string })[] } = $props();
</script>
<div class="en-select-wrap"><select {...rest} bind:value class="en-select">{#each options as option}<option value={typeof option === 'string' ? option : option.value}>{typeof option === 'string' ? option : option.label}</option>{/each}</select></div>
