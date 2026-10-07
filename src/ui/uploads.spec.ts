import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeFilename, slugify, stageFiles, stripWrapFiles, publish, pendingImport, resumeImport, cancelPendingImport } from './uploads';

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


describe('hub atomic site publication', () => {
  const statusUrl = '/account/sites/site-id/deployments/deployment-id';
  const options = { password: 'private phrase', write_password: '', ttl: '7d', write_policy: 'owner' };
  const status = (state: string, stored = 0) => ({ deployment_id: 'deployment-id', state, status_url: statusUrl,
    progress: { stored_files: stored }, ...(state === 'committed' ? { url: 'https://content.test/published/' } : {}) });
  const response = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map();
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    vi.stubGlobal('location', { origin: 'http://localhost' });
  });
  afterEach(() => vi.unstubAllGlobals());
  async function upload() { return (await stageFiles([new File(['zip'], 'site.zip')]))!; }

  it('prepares staged bytes and reports success only after commit', async () => {
    const responses = [response({ id: 'site-id', url: 'https://content.test/published/' }), response(status('uploading'), 202),
      response(status('uploading')), response(status('uploading', 1), 202), response(status('ready', 2)), response(status('committed', 2))];
    const fetcher = vi.fn(async () => responses.shift()!); vi.stubGlobal('fetch', fetcher);
    const progress: string[] = [];
    const result = await publish(await upload(), options, { onProgress: value => progress.push(value.text) });
    expect(result.file_count).toBe(2);
    expect(progress).toEqual(['Uploading ZIP…', 'Preparing files: 0 files ready', 'Preparing files: 1 files ready', 'Publishing…']);
    expect(fetcher.mock.calls.map(call => (call as unknown[])[0])).toEqual(['/account/sites', '/account/sites/site-id/import', statusUrl, `${statusUrl}/prepare`, `${statusUrl}/prepare`, `${statusUrl}/commit`]);
    const init = (fetcher.mock.calls[1] as unknown[])[1] as RequestInit;
    expect(init.headers).toMatchObject({ prefer: 'respond-async' });
    expect(pendingImport()).toBeNull();
  });

  it('recovers a lost commit response using the durable receipt', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(status('ready', 2)))
      .mockRejectedValueOnce(new TypeError('connection lost')).mockResolvedValueOnce(response(status('committed', 2)));
    vi.stubGlobal('fetch', fetcher);
    const result = await resumeImport({ siteId: 'site-id', slug: 'site', statusUrl });
    expect(result.url).toBe('https://content.test/published/');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('retains a failed preparation for retry without creating or uploading another site', async () => {
    const responses = [response({ id: 'site-id' }), response(status('uploading'), 202), response(status('uploading')),
      response({ message: 'Preparation unavailable' }, 503), response(status('uploading'))];
    const fetcher = vi.fn(async () => responses.shift()!); vi.stubGlobal('fetch', fetcher);
    const staged = await upload();
    await expect(publish(staged, options)).rejects.toThrow('Resume publication');
    expect(pendingImport()).toEqual({ siteId: 'site-id', slug: 'site', statusUrl });
    expect([...values.values()].join('')).not.toContain('private phrase');
    responses.push(response(status('uploading')), response(status('ready', 1)), response(status('committed', 1)));
    expect((await publish(staged, options)).file_count).toBe(1);
    expect(fetcher.mock.calls.filter(call => (call as unknown[])[0] === '/account/sites')).toHaveLength(1);
    expect(fetcher.mock.calls.filter(call => (call as unknown[])[0] === '/account/sites/site-id/import')).toHaveLength(1);
  });

  it('reuses the import identity when its first response is lost', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ id: 'site-id' })).mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(response(status('ready'), 202)).mockResolvedValueOnce(response(status('ready'))).mockResolvedValueOnce(response(status('committed')));
    vi.stubGlobal('fetch', fetcher);
    const staged = await upload();
    await expect(publish(staged, options)).rejects.toThrow('Retry with the selected files');
    await publish(staged, options);
    expect(fetcher.mock.calls[1][1].headers['idempotency-key']).toBe(fetcher.mock.calls[2][1].headers['idempotency-key']);
    expect(fetcher.mock.calls.filter(call => call[0] === '/account/sites')).toHaveLength(1);
  });

  it('rejects foreign recovery URLs and can cancel a known pending session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(resumeImport({ siteId: 'site-id', slug: 'site', statusUrl: 'https://foreign.test/account/sites/x/deployments/y' })).rejects.toThrow('another host');
    expect(fetch).not.toHaveBeenCalled();
    await cancelPendingImport({ siteId: 'site-id', slug: 'site', statusUrl });
    expect(fetch).toHaveBeenCalledWith(statusUrl, { method: 'DELETE' });
  });

  async function folder() {
    return (await stageFiles([
      new File(['hello'], 'index.html', { type: 'text/html' }),
      new File(['styles'], 'café main.css', { type: 'text/css' }),
    ], [], true))!;
  }

  const folderStatus = (state: string, missing: string[] = []) => ({ ...status(state, 2 - missing.length), progress: { stored_files: 2 - missing.length, missing_paths: missing } });

  it('publishes a folder with one immutable manifest and a single commit', async () => {
    const responses = [response({ id: 'site-id', content_generation: 0 }), response(folderStatus('uploading', ['index.html', 'café main.css']), 201),
      response({ stored: true }, 201), response({ stored: true }, 201), response(folderStatus('uploading')),
      response(folderStatus('ready')), response(folderStatus('committed'))];
    const fetcher = vi.fn(async () => responses.shift()!); vi.stubGlobal('fetch', fetcher);
    expect((await publish(await folder(), options)).file_count).toBe(2);
    expect(fetcher.mock.calls.map(call => (call as unknown[])[0])).toEqual([
      '/account/sites', '/account/sites/site-id/deployments', `${statusUrl}/files/index.html`,
      `${statusUrl}/files/caf%C3%A9%20main.css`, statusUrl, `${statusUrl}/prepare`, `${statusUrl}/commit`,
    ]);
    const manifest = JSON.parse(((fetcher.mock.calls[1] as unknown[])[1] as RequestInit).body as string);
    expect(manifest).toMatchObject({ mode: 'replace', expected_version: 0, files: [
      { path: 'index.html', size: 5, content_type: 'text/html', sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' },
      { path: 'café main.css', size: 6, content_type: 'text/css' },
    ] });
    expect(pendingImport()).toBeNull();
  });

  it('retries only missing folder inputs without offering reload recovery prematurely', async () => {
    const responses = [response({ id: 'site-id' }), response(folderStatus('uploading', ['index.html', 'café main.css']), 201),
      response({ stored: true }, 201), response({ message: 'Upload unavailable' }, 503)];
    const fetcher = vi.fn(async () => responses.shift()!); vi.stubGlobal('fetch', fetcher);
    const staged = await folder();
    await expect(publish(staged, options)).rejects.toThrow('Retry with the selected files');
    expect(pendingImport()).toBeNull();
    responses.push(response(folderStatus('uploading', ['café main.css'])), response({ stored: true }, 201),
      response(folderStatus('uploading')), response(folderStatus('ready')), response(folderStatus('committed')));
    expect((await publish(staged, options)).file_count).toBe(2);
    expect(fetcher.mock.calls.filter(call => (call as unknown[])[0] === '/account/sites')).toHaveLength(1);
    expect(fetcher.mock.calls.filter(call => (call as unknown[])[0] === '/account/sites/site-id/deployments')).toHaveLength(1);
    expect(fetcher.mock.calls.filter(call => (call as unknown[])[0] === `${statusUrl}/files/index.html`)).toHaveLength(1);
  });

  it('retains folder identity after a lost create response and supports reload after all inputs arrive', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ id: 'site-id' })).mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(response(folderStatus('uploading', ['index.html', 'café main.css']), 201))
      .mockResolvedValueOnce(response({ stored: true }, 201)).mockResolvedValueOnce(response({ stored: true }, 201))
      .mockResolvedValueOnce(response(folderStatus('uploading'))).mockResolvedValueOnce(response({ message: 'Preparation unavailable' }, 503))
      .mockResolvedValueOnce(response(folderStatus('uploading')));
    vi.stubGlobal('fetch', fetcher);
    const staged = await folder();
    await expect(publish(staged, options)).rejects.toThrow('Retry with the selected files');
    expect(pendingImport()).toBeNull();
    await expect(publish(staged, options)).rejects.toThrow('Resume publication');
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[2][1].body);
    expect(pendingImport()).toEqual({ siteId: 'site-id', slug: 'site', statusUrl });
    expect([...values.values()].join('')).not.toContain('private phrase');
    fetcher.mockResolvedValueOnce(response(folderStatus('ready'))).mockResolvedValueOnce(response(folderStatus('committed')));
    expect((await resumeImport(pendingImport()!)).file_count).toBe(2);
    expect(pendingImport()).toBeNull();
  });

});
