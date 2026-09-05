<script lang="ts">
  let { prefix = '', suffix = '', value = $bindable(''), id, ariaLabel, disabled = false, oninput }:
    { prefix?: string; suffix?: string; value?: string; id?: string; ariaLabel?: string; disabled?: boolean; oninput?: () => void } = $props();
</script>
<div class="en-url"><span class="en-url-static">{prefix}</span><input {id} bind:value {disabled} {oninput} aria-label={ariaLabel} spellcheck="false" autocomplete="off" />{#if suffix}<span class="en-url-static">{suffix}</span>{/if}</div>
