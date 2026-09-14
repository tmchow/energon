<script lang="ts">
  import type { UpstreamSnapshot } from '../types';
  import Card from './Card.svelte';
  import Badge from './Badge.svelte';
  import Button from './Button.svelte';
  import Timestamp from './Timestamp.svelte';

  let { snapshot, dismissed = false, onDismiss }: {
    snapshot: UpstreamSnapshot;
    dismissed?: boolean;
    onDismiss: () => void;
  } = $props();

  const showCard = $derived(snapshot.status === 'update' && !dismissed);
  const title = $derived(releaseTitle(snapshot.latest_tag));

  function releaseTitle(tag: string | null): string {
    if (!tag) return 'A newer release is available';
    return `${tag.replace(/^v/i, '')} is available`;
  }

  function note(current: UpstreamSnapshot): string {
    switch (current.status) {
      case 'failed':
        return 'Could not check for a newer release.';
      case 'unknown':
        return current.latest_tag
          ? `This build has no version. Latest release is ${current.latest_tag.replace(/^v/i, '')}.`
          : 'This build has no version.';
      case 'current':
      case 'update':
        return '';
      default: {
        const _n: never = current.status;
        return _n;
      }
    }
  }
</script>

{#if showCard}
  <Card id="admin-update" title={title} className="en-admin-card">
    {#snippet headEnd()}<Badge tone="warn">Update</Badge>{/snippet}
    <p class="en-muted-copy">
      This Energon is {snapshot.this_version ?? 'unknown'}.{#if snapshot.published_at}
        Released <Timestamp value={snapshot.published_at} dateOnly />.{/if}
    </p>
    {#if snapshot.operator.length}
      <p class="en-admin-update-heading">Operator</p>
      <ul id="admin-update-operator" class="en-admin-update-ops">
        {#each snapshot.operator as item (item)}<li>{item}</li>{/each}
      </ul>
    {/if}
    <div class="en-admin-update-run">
      {#if snapshot.latest_url}
        <Button href={snapshot.latest_url} variant="outline" size="sm">Read the release</Button>
      {/if}
      <Button href={snapshot.docs_url} variant="outline" size="sm">How to update</Button>
      <Button id="admin-update-dismiss" variant="ghost" size="sm" onclick={onDismiss}>Dismiss</Button>
    </div>
  </Card>
{:else if note(snapshot)}
  <p id="admin-update-note" class="en-muted-copy en-admin-update-note">
    {note(snapshot)}
    {#if snapshot.status === 'unknown' && snapshot.latest_url}
      <a href={snapshot.latest_url}>Read the release</a>.
      <a href={snapshot.docs_url}>How to update</a>.
    {/if}
  </p>
{/if}
