import { render } from 'svelte/server';
import App from './App.svelte';
import type { PageProps } from './types';

export function renderUi(props: PageProps) {
  return render(App, { props }).body;
}
