<script lang="ts">
  import Conduit from './Conduit.svelte';
  import Icon from './Icon.svelte';
  import CubeMark from './CubeMark.svelte';
  import type { IconName } from '../icons';
  let { nodes, vertical = false, units = 2, duration = '2.8s', gap = 0 }:
    { nodes: { label: string; icon?: IconName; cube?: boolean; charged?: boolean }[]; vertical?: boolean; units?: number; duration?: string; gap?: number } = $props();
</script>
<div class="en-flow" class:en-flow--vertical={vertical} style:gap="{gap}px">
  {#each nodes as node, i}
    {#if i}<Conduit direction={vertical ? 'v' : 'h'} {units} {duration} className="en-flow-link" />{/if}
    <span class="en-mk-node" class:en-mk-node--charged={node.charged}>{#if node.cube}<CubeMark size={16} glow={false} />{:else if node.icon}<Icon name={node.icon} size={15} />{/if}{node.label}</span>
  {/each}
</div>
