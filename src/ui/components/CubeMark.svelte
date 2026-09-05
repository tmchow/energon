<script lang="ts">
  import logo from '../design/assets/logo.svg';
  const generatedId = $props.id();
  let { size = 32, glow = true, id = generatedId }: { size?: number; glow?: boolean; id?: string } = $props();
  const svg = $derived(logo.replace(/^<\?xml[^>]*>\s*/, '')
    .replace('<svg ', `<svg width="${size}" height="${size}" `)
    .replace('filter="url(#energon-glow)"', glow ? 'filter="url(#energon-glow)"' : '')
    .replaceAll('energon-', `${id}-`));
</script>
{@html svg}
