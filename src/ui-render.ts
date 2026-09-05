import { renderUi } from './generated/ui.js';
import uiCss from './generated/ui.css';
import manifest from './generated/ui-manifest.json';
import { escapeHtml } from './chrome';
import type { PageProps } from './ui/types';

export function uiPage(title: string, props: PageProps, extraHead = ''): string {
  const interactive = props.page !== 'gate' && props.page !== 'markdown';
  const bootstrap = JSON.stringify(props).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${uiCss}</style>${extraHead}</head><body class="page-${props.page}">
<div id="app">${renderUi(props)}</div>
${interactive ? `<script id="bootstrap" type="application/json">${bootstrap}</script><script type="module" src="${manifest.script}"></script>` : ''}
</body></html>`;
}
