<script lang="ts">
  let { prefix = '', suffix = '', value = $bindable(''), id, disabled = false, oninput }:
    { prefix?: string; suffix?: string; value?: string; id?: string; disabled?: boolean; oninput?: () => void } = $props();
</script>
<div class="en-url"><span class="en-url-static">{prefix}</span><input {id} bind:value {disabled} {oninput} spellcheck="false" autocomplete="off" />{#if suffix}<span class="en-url-static">{suffix}</span>{/if}</div>
