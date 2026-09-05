<script lang="ts">
  import IconButton from './IconButton.svelte';
  import CopyButton from './CopyButton.svelte';
  let { value = $bindable(''), words = [], id, generateId, copyId, disabled = false, describedby }:
    { value?: string; words?: readonly string[]; id: string; generateId?: string; copyId?: string; disabled?: boolean; describedby?: string } = $props();
  let input: HTMLInputElement;
  function generate() {
    if (!words.length) return;
    const random = crypto.getRandomValues(new Uint32Array(5));
    value = [...random].map(n => words[n % words.length]).join('-');
    input.focus();
    requestAnimationFrame(() => input.select());
  }
</script>
<div class="en-pw">
  <input bind:this={input} {id} type="text" class="en-input" bind:value {disabled} aria-describedby={describedby} autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" inputmode="text" onfocus={() => input.select()} />
  <div class="en-pw-tools"><IconButton id={generateId} icon="dice" label="Generate a readable password" onclick={generate} disabled={disabled || !words.length} />
    {#if value.trim()}<CopyButton id={copyId} text={value.trim()} label="Copy password" iconOnly />{/if}
  </div>
</div>
