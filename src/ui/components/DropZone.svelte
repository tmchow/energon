<script lang="ts">
  import type { Snippet } from 'svelte';
  import CubeMark from './CubeMark.svelte';
  import Button from './Button.svelte';
  let { over = false, busy = false, onFiles, onFolder, children }:
    { over?: boolean; busy?: boolean; onFiles?: () => void; onFolder?: () => void; children?: Snippet } = $props();
</script>
<div id="drop" class="en-drop" class:en-drop--over={over} class:en-drop--busy={busy} aria-busy={busy}>
  {#if children}{@render children()}{:else}
    <div id="drop-idle"><div class="en-drop-icon"><CubeMark size={38} /></div>
      <div class="en-drop-title">Drop a folder, zip, or file</div>
      <div class="en-drop-sub">Markdown opens as a page. A folder or zip becomes a site. Upload ready-to-serve files; nothing is written until you Publish.</div>
      <div class="en-drop-actions"><Button variant="primary" id="pick-files" onclick={onFiles}>Choose files</Button><Button id="pick-folder" onclick={onFolder}>Choose folder</Button></div>
    </div>
  {/if}
</div>
