<script lang="ts">
  import type { Snippet } from 'svelte';
  import Button from './Button.svelte';
  import CopyButton from './CopyButton.svelte';
  import IconButton from './IconButton.svelte';
  let { tone = 'ok', password, writePassword, children, action, onDismiss, className = '' }:
    { tone?: 'ok' | 'err' | 'warn'; password?: string; writePassword?: string; children?: Snippet; action?: { label: string; onclick: () => void }; onDismiss?: () => void; className?: string } = $props();
</script>
<div class="en-flash en-flash--{tone} {className}" class:en-flash--dismissible={!!onDismiss} role={tone === 'err' ? 'alert' : 'status'}>
  <div class="en-flash-body">
    {@render children?.()}
    {#if password}<p class="en-flash-pw">Password <code>{password}</code><CopyButton text={password} label="Copy password" iconOnly size="sm" /></p>{/if}
    {#if writePassword}<p class="en-flash-pw">Write password <code>{writePassword}</code><CopyButton text={writePassword} label="Copy write password" iconOnly size="sm" /></p>{/if}
    {#if action}<div class="en-flash-actions"><Button variant="outline" size="sm" onclick={action.onclick}>{action.label}</Button></div>{/if}
  </div>
  {#if onDismiss}<IconButton icon="x" label="Dismiss" size="sm" class="en-flash-dismiss" onclick={onDismiss} />{/if}
</div>
