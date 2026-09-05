import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const generated = path.join(root, 'src/generated');
const common = { absWorkingDir: root, bundle: true, format: 'esm', target: 'es2022', loader: { '.svg': 'text' }, logLevel: 'warning' };

function sveltePlugin(generate) {
  return {
    name: 'svelte',
    setup(builder) {
      builder.onLoad({ filter: /\.svelte$/ }, async ({ path: filename }) => {
        const source = await readFile(filename, 'utf8');
        const result = compile(source, { filename, generate, css: 'injected' });
        return {
          contents: result.js.code, loader: 'js', resolveDir: path.dirname(filename),
          warnings: result.warnings.map(w => ({ text: w.message, location: w.start ? { file: filename, line: w.start.line, column: w.start.column } : undefined })),
        };
      });
    },
  };
}

export async function buildUI() {
  await mkdir(generated, { recursive: true });
  const client = await build({ ...common, entryPoints: ['src/ui/client.ts'], outfile: 'app.js', plugins: [sveltePlugin('client')], conditions: ['browser'], minify: true, write: false });
  const bytes = client.outputFiles[0].contents;
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const asset = `/static/ui/app-${hash}.js`;
  await mkdir(path.join(root, 'public/static/ui'), { recursive: true });
  await writeFile(path.join(root, 'public', asset), bytes);
  await build({ ...common, entryPoints: ['src/ui/server.ts'], outfile: 'src/generated/ui.js', plugins: [sveltePlugin('server')], platform: 'neutral', conditions: ['worker'], minify: true });
  await build({ absWorkingDir: root, entryPoints: ['src/ui/styles.css'], bundle: true, minify: true, outfile: 'src/generated/ui.css', logLevel: 'warning', plugins: [{
    name: 'design-css',
    setup(builder) {
      builder.onLoad({ filter: /design\/components\/components\.css$/ }, async ({ path: filename }) => ({
        // The handoff's glob closes its opening CSS comment; keep the source intact.
        contents: (await readFile(filename, 'utf8')).replace('./**/*.jsx', '*.jsx'), loader: 'css', resolveDir: path.dirname(filename),
      }));
    },
  }] });
  await writeFile(path.join(generated, 'ui-manifest.json'), JSON.stringify({ script: asset }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildUI();
  if (process.argv.includes('--specimen')) {
    const output = path.join(root, '.context/ui-specimen');
    await mkdir(output, { recursive: true });
    await build({ ...common, entryPoints: ['src/ui/specimen/client.ts'], plugins: [sveltePlugin('client')], conditions: ['browser'], outfile: path.join(output, 'specimen.js') });
    const css = await readFile(path.join(generated, 'ui.css'), 'utf8');
    await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Energon component specimen</title><style>${css}</style></head><body><div id="app"></div><script type="module" src="./specimen.js"></script></body></html>`);
  }
}
