<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  let { variant = 'secondary', size = 'lg', charged = false, block = false, loading = false,
    href, children, icon, iconRight, class: className = '', disabled = false, type = 'button', ...rest
  }: HTMLButtonAttributes & { variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
    size?: 'sm' | 'md' | 'lg'; charged?: boolean; block?: boolean; loading?: boolean;
    href?: string; children?: Snippet; icon?: Snippet; iconRight?: Snippet } = $props();
  const classes = $derived(['en-btn', `en-btn--${variant}`, `en-btn--${size}`, charged && 'en-btn--charged', block && 'en-btn--block', className].filter(Boolean).join(' '));
</script>

{#snippet content()}{@render icon?.()}{@render children?.()}{@render iconRight?.()}{/snippet}
{#if href}
  <a {href} class={classes} aria-disabled={disabled || loading || undefined}>{@render content()}</a>
{:else}
  <button {...rest} {type} class={classes} disabled={disabled || loading} aria-busy={loading || undefined}>{@render content()}</button>
{/if}
