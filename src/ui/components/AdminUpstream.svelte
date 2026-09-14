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
  const latestLabel = $derived(displayVersion(snapshot.latest_tag));
  const title = $derived(latestLabel ? `${latestLabel} is available` : 'A newer release is available');

  function displayVersion(tag: string | null): string | null {
    if (!tag) return null;
    return tag.replace(/^v/i, '');
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
      This Energon is {snapshot.this_version ?? 'unknown'}.
      {#if latestLabel && snapshot.published_at}
        {latestLabel} was released <Timestamp value={snapshot.published_at} dateOnly />.
      {/if}
    </p>
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
