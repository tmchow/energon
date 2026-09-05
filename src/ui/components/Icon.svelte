<script lang="ts">
  import { icons, type IconName } from '../icons';
  let { name, size = 19, title, className = '' }: { name: IconName; size?: number; title?: string; className?: string } = $props();
</script>
<span class={className} style:width="{size}px" style:height="{size}px" style:display="inline-flex" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title}>{@html icons[name].replace('<svg ', `<svg width="${size}" height="${size}" `)}</span>
