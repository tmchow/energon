<script lang="ts">
  import CopyButton from './CopyButton.svelte';
  let { text, id }: { text: string; id?: string } = $props();
</script>
<div class="en-copy-block"><pre {id}>{text}</pre><CopyButton {text} /></div>
