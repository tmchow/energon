declare module '*generated/ui.js' {
  export function renderUi(props: import('./ui/types').PageProps): string;
}

declare module '*generated/ui-manifest.json' {
  const manifest: { script: string };
  export default manifest;
}
