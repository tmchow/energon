<script lang="ts">
  let { options, value = $bindable(''), onChange, block = false, ariaLabel, id, className = '', disabled = false }:
    { options: (string | { value: string; label: string })[]; value?: string; onChange?: (value: string) => void; block?: boolean; ariaLabel?: string; id?: string; className?: string; disabled?: boolean } = $props();

  function slidingPill(node: HTMLElement) {
    let armed = false;
    const place = (animate: boolean) => {
      const on = node.querySelector<HTMLButtonElement>('button.on');
      const pill = node.querySelector<HTMLElement>('.en-seg-pill');
      if (!on || !pill) return;
      if (!animate) node.classList.remove('en-seg--animate');
      pill.style.transform = `translateX(${on.offsetLeft}px)`;
      pill.style.width = `${on.offsetWidth}px`;
      node.classList.add('en-seg--ready');
      if (animate) {
        void node.offsetWidth;
        node.classList.add('en-seg--animate');
      }
      armed = true;
    };
    const ro = new ResizeObserver(() => place(false));
    ro.observe(node);
    $effect(() => {
      const animate = armed;
      const current = value;
      const list = options;
      requestAnimationFrame(() => {
        const known = list.some((option) => (typeof option === 'string' ? option : option.value) === current);
        place(animate && known);
      });
    });
    return () => ro.disconnect();
  }
</script>
<div {id} class="en-seg {className}" class:en-seg--block={block} role="group" aria-label={ariaLabel} aria-disabled={disabled ? 'true' : undefined} {@attach slidingPill}>
  <i class="en-seg-pill" aria-hidden="true"></i>
  {#each options as option (typeof option === 'string' ? option : option.value)}
    {@const key = typeof option === 'string' ? option : option.value}
    <button type="button" class:on={value === key} aria-pressed={value === key} {disabled} onclick={() => { value = key; onChange?.(key); }}>{typeof option === 'string' ? option : option.label}</button>
  {/each}
</div>
