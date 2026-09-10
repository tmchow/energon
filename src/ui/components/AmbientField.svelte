<script lang="ts">
  import { onMount } from 'svelte';
  import { mountAmbientField } from '../ambient-field';
  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  onMount(() => mountAmbientField(host, canvas)?.destroy);
</script>
<div class="en-ambient" bind:this={host} aria-hidden="true"><canvas bind:this={canvas}></canvas></div>
