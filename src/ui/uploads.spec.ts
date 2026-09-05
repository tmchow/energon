import { describe, expect, it } from 'vitest';
import { safeFilename, slugify, stageFiles, stripWrapFiles } from './uploads';

describe('hub upload staging', () => {
  it('distinguishes a single-file folder from an individual upload', async () => {
    const file = new File(['<h1>Ready</h1>'], 'index.html', { type: 'text/html' });
    Object.defineProperty(file, 'webkitRelativePath', { value: 'My Prototype/index.html' });
    const folder = await stageFiles([file], [], true);
    expect(folder).toMatchObject({ kind: 'folder', slug: 'my-prototype' });
    expect(stripWrapFiles(folder!.files)).toEqual([{ path: 'index.html', file }]);
    expect(await stageFiles([file])).toMatchObject({ kind: 'loose', filename: 'index.html', file });
  });

  it('stages ZIPs as sites and preserves loose-file names for editing', async () => {
    const zip = new File(['zip fixture'], 'Quarterly Review.ZIP');
    expect(await stageFiles([zip])).toMatchObject({ kind: 'zip', slug: 'quarterly-review', file: zip });
    const markdown = new File(['# Brief'], 'Design brief.md');
    expect(await stageFiles([markdown])).toMatchObject({ kind: 'loose', filename: 'Design brief.md' });
    expect(await stageFiles([])).toBeNull();
  });

  it('strips only a shared directory and preserves nested and mixed paths', () => {
    const file = new File(['contents'], 'asset');
    expect(stripWrapFiles([{ path: 'site/index.html', file }, { path: 'site/assets/main.css', file }]).map(item => item.path)).toEqual(['index.html', 'assets/main.css']);
    const mixed = [{ path: 'index.html', file }, { path: 'assets/main.css', file }];
    expect(stripWrapFiles(mixed)).toEqual(mixed);
  });

  it('normalizes edited upload names without allowing a path or an empty slug', () => {
    expect(safeFilename('../folder/report.md', 'file')).toBe('report.md');
    expect(safeFilename('C:\\folder\\brief.md', 'file')).toBe('brief.md');
    expect(slugify(' ** Design Review ** ')).toBe('design-review');
    expect(slugify('...')).toBe('site');
    expect(slugify('a'.repeat(100))).toHaveLength(63);
  });
});
