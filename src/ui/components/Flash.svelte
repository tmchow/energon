<script lang="ts">
  import type { Snippet } from 'svelte';
  import CopyButton from './CopyButton.svelte';
  let { tone = 'ok', password, writePassword, children, className = '' }: { tone?: 'ok' | 'err' | 'warn'; password?: string; writePassword?: string; children?: Snippet; className?: string } = $props();
</script>
<div class="en-flash en-flash--{tone} {className}" role={tone === 'err' ? 'alert' : 'status'}>
  {@render children?.()}
  {#if password}<p class="en-flash-pw">Password <code>{password}</code><CopyButton text={password} label="Copy password" iconOnly size="sm" /></p>{/if}
  {#if writePassword}<p class="en-flash-pw">Write password <code>{writePassword}</code><CopyButton text={writePassword} label="Copy write password" iconOnly size="sm" /></p>{/if}
</div>
