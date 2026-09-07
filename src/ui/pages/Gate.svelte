<script lang="ts">
  import type { GateData } from '../types';
  import CubeMark from '../components/CubeMark.svelte';
  import Card from '../components/Card.svelte';
  import Field from '../components/Field.svelte';
  import Input from '../components/Input.svelte';
  import Flash from '../components/Flash.svelte';
  import Button from '../components/Button.svelte';
  let { data }: { data: GateData } = $props();
</script>
<main class="en-gate-page"><Card className="en-gate" tight>
  <div class="en-gate en-gate-inner">
    <span class="en-mark en-mark--breathe" style:--mark-size="35px"><CubeMark size={35} /></span>
    <h1>Energon</h1><p class="en-lede">This link is password-protected.</p>
    <p class="en-gate-instructions">Ask the person who sent you this link for the password.</p>
    {#if data.wrong}<Flash tone="err">That password is wrong.</Flash>{/if}
    {#if data.limited}<Flash tone="err">Too many password attempts. Try again later.</Flash>
    {:else}<form method="post" action={data.action}>
      <Field label="Password" htmlFor="share-password"><Input id="share-password" type="password" name="password" autocomplete="current-password" required /></Field>
      <Button type="submit" variant="primary" block>Open</Button>
    </form>{/if}
    <p class="en-lede en-gate-agent">Agents: send header <code>{data.passwordHeader}</code>.</p>
  </div>
</Card></main>
