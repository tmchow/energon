<script lang="ts">
  let { options, value = $bindable(''), onChange, block = false, ariaLabel, id, className = '', disabled = false }:
    { options: (string | { value: string; label: string })[]; value?: string; onChange?: (value: string) => void; block?: boolean; ariaLabel?: string; id?: string; className?: string; disabled?: boolean } = $props();
</script>
<div {id} class="en-seg {className}" class:en-seg--block={block} role="group" aria-label={ariaLabel} aria-disabled={disabled ? 'true' : undefined}>
  {#each options as option}
    {@const key = typeof option === 'string' ? option : option.value}
    <button type="button" class:on={value === key} aria-pressed={value === key} {disabled} onclick={() => { value = key; onChange?.(key); }}>{typeof option === 'string' ? option : option.label}</button>
  {/each}
</div>
