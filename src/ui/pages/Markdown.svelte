<script lang="ts">
  import type { MarkdownData } from '../types';
  let { data }: { data: MarkdownData } = $props();
</script>
<main class="en-md-page">
  <article class="en-md">{@html data.html}</article>
</main>
