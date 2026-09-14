<script lang="ts">
  import type { MarkdownData } from '../types';
  let { data }: { data: MarkdownData } = $props();
</script>
<main class="en-wrap en-md-wrap">
  <article class="en-md">{@html data.html}</article>
</main>
