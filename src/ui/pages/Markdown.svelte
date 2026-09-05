<script lang="ts">
  import type { MarkdownData } from '../types';
  import AppHeader from '../components/AppHeader.svelte';
  import Button from '../components/Button.svelte';
  import Card from '../components/Card.svelte';
  import Timestamp from '../components/Timestamp.svelte';
  import { formatBytes } from '../../config';
  let { data }: { data: MarkdownData } = $props();
</script>
<AppHeader publicPage>{#snippet end()}<span class="en-who">{data.rawHref.split('?')[0].replace(/^\//, '')}</span><Button href={data.rawHref} variant="ghost" size="sm">Raw</Button>{/snippet}</AppHeader>
<main class="en-wrap en-md-wrap"><p class="en-md-file">{data.filename}{#if data.size !== undefined}{' · '}{formatBytes(data.size)}{/if}{#if data.updatedAt}{' · updated '}<Timestamp value={data.updatedAt} />{/if}</p><Card tight><article class="en-md">{@html data.html}</article></Card></main>
