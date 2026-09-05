<script lang="ts">
  import Flash from './Flash.svelte';
  let { token, tokenEnv }: { token: string; tokenEnv: string } = $props();
</script>
<Flash className="en-token-reveal">
  <p class="en-token"><code>export {tokenEnv}={token}</code></p>
</Flash>
