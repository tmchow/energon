import { hydrate } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app');
const bootstrap = document.getElementById('bootstrap');
if (target && bootstrap) hydrate(App, { target, props: JSON.parse(bootstrap.textContent || '{}') });
