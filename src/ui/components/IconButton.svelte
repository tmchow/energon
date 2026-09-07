<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import type { IconName } from '../icons';
  let { icon, label, on = false, tone, size = 'md', iconSize, href, extra = false, more = false, class: className = '', ...rest }:
    HTMLButtonAttributes & { icon: IconName; label: string; on?: boolean; tone?: 'danger'; size?: 'sm' | 'md'; iconSize?: number; href?: string; extra?: boolean; more?: boolean } = $props();
  const classes = $derived(['en-icon-btn', on && 'en-icon-btn--on', tone && `en-icon-btn--${tone}`, `en-icon-btn--${size}`, extra && 'en-icon-btn--extra', more && 'en-icon-btn--more', className].filter(Boolean).join(' '));
</script>
{#if href}
  <a {href} class={classes} title={label} aria-label={label}><Icon name={icon} size={iconSize} /></a>
{:else}
  <button {...rest} type="button" class={classes} title={label} aria-label={label}><Icon name={icon} size={iconSize} /></button>
{/if}
