import { api, jsonBody } from './api';

export type UploadFile = { path: string; file: File };
export type StagedUpload = { kind: 'loose' | 'folder' | 'zip'; file?: File; files: UploadFile[]; slug: string; filename: string; createdSite?: PublishResult; importKey?: string; pendingImport?: PendingImport; folderManifest?: ManifestFile[]; folderStatusUrl?: string };
type ManifestFile = { path: string; size: number; sha256: string; content_type: string };
export type PublishResult = { url: string; content_generation?: number; id?: string; slug?: string; filename?: string; file_count?: number; password?: string; password_protected?: boolean; write_password?: string; write_password_protected?: boolean; written?: string[] };

export function safeFilename(name: string, fallback: string): string {
  const base = String(name || fallback || 'file').replace(/\\/g, '/').split('/').pop() || 'file';
  return base.replace(/[^\w.\- ()[\]]+/g, '-').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 180) || fallback || 'file';
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'site';
}

export async function readEntry(entry: FileSystemEntry, prefix = ''): Promise<UploadFile[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    return [{ path: prefix + entry.name, file }];
  }
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const entries: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    entries.push(...batch);
  }
  const files: UploadFile[] = [];
  for (const child of entries) files.push(...await readEntry(child, prefix + entry.name + '/'));
  return files;
}

export function stripWrapFiles(files: UploadFile[]): UploadFile[] {
  if (!files.length) return files;
  const first = files[0].path.split('/')[0];
  return files.every(item => item.path.startsWith(first + '/'))
    ? files.map(item => ({ ...item, path: item.path.slice(first.length + 1) })) : files;
}

export async function stageFiles(files: File[], entries: FileSystemEntry[] = [], folder = false): Promise<StagedUpload | null> {
  const directory = entries.find(entry => entry.isDirectory);
  if (directory) return { kind: 'folder', files: await readEntry(directory), slug: slugify(directory.name), filename: '' };
  if (!files.length) return null;
  if (!folder && files.length === 1) {
    const file = files[0];
    return { kind: /\.zip$/i.test(file.name) ? 'zip' : 'loose', file, files: [{ path: file.name, file }], slug: slugify(file.name.replace(/\.zip$/i, '')), filename: file.name };
  }
  return { kind: 'folder', files: files.map(file => ({ path: file.webkitRelativePath || file.name, file })), slug: slugify(files[0].webkitRelativePath?.split('/')[0] || 'site'), filename: '' };
}

export type PendingImport = { siteId: string; slug: string; statusUrl: string };
export type PublishProgress = { phase: 'uploading' | 'preparing' | 'committing'; text: string };
type ImportStatus = { deployment_id: string; state: string; status_url: string; url?: string; progress?: { stored_files?: number; missing_paths?: string[] } };
type PublishHooks = { onProgress?: (progress: PublishProgress) => void; onPending?: (pending: PendingImport | null) => void };
const PENDING_IMPORT_KEY = 'energon.pending-site-import';

function statusPath(raw: string): string {
  const origin = globalThis.location?.origin || 'http://localhost';
  const url = new URL(raw, origin);
  if (url.origin !== origin) throw new Error('The import status address belongs to another host.');
  const path = url.pathname.replace(/^\/v1\//, '/account/');
  if (!/^\/account\/sites\/[^/]+\/deployments\/[^/]+$/.test(path)) throw new Error('The import status address is invalid.');
  return path;
}

export function pendingImport(): PendingImport | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_IMPORT_KEY) || 'null') as PendingImport | null;
    if (!value || typeof value.siteId !== 'string' || typeof value.slug !== 'string') return null;
    return { ...value, statusUrl: statusPath(value.statusUrl) };
  } catch { return null; }
}

function rememberImport(pending: PendingImport | null, hooks: PublishHooks) {
  try {
    if (pending) sessionStorage.setItem(PENDING_IMPORT_KEY, JSON.stringify(pending));
    else sessionStorage.removeItem(PENDING_IMPORT_KEY);
  } catch { /* In-memory retry remains available when browser storage is disabled. */ }
  hooks.onPending?.(pending);
}

export async function cancelPendingImport(pending: PendingImport): Promise<void> {
  await api(statusPath(pending.statusUrl), { method: 'DELETE' });
  rememberImport(null, {});
}

export async function resumeImport(pending: PendingImport, hooks: PublishHooks = {}): Promise<PublishResult> {
  const path = statusPath(pending.statusUrl);
  let status = await api<ImportStatus>(path);
  for (;;) {
    if (status.state === 'committed') {
      if (!status.url) throw new Error('The publication receipt has no URL. Retry to recover it.');
      rememberImport(null, hooks);
      return { id: pending.siteId, slug: pending.slug, url: status.url, file_count: status.progress?.stored_files || 0 };
    }
    if (!['uploading', 'preparing', 'ready'].includes(status.state)) throw new Error(`Publication stopped (${status.state}). Existing published content is unchanged.`);
    const committing = status.state === 'ready';
    hooks.onProgress?.(committing ? { phase: 'committing', text: 'Publishing…' }
      : { phase: 'preparing', text: `Preparing files: ${status.progress?.stored_files || 0} files ready` });
    const action = committing ? 'commit' : 'prepare';
    try { status = await api<ImportStatus>(`${path}/${action}`, { method: 'POST' }); }
    catch (error) {
      const recovered = await api<ImportStatus>(path).catch(() => null);
      if (recovered?.state === 'committed' || (!committing && recovered?.state === 'ready')) { status = recovered; continue; }
      throw error;
    }
  }
}

async function stageFolder(upload: StagedUpload, site: PublishResult, siteId: string, slug: string, hooks: PublishHooks): Promise<void> {
  const files = stripWrapFiles(upload.files).filter(item => item.path && !item.path.endsWith('/'));
  if (!upload.folderManifest) {
    const manifest: ManifestFile[] = [];
    for (const item of files) {
      hooks.onProgress?.({ phase: 'preparing', text: `Checking files: ${manifest.length} of ${files.length}` });
      const hash = await crypto.subtle.digest('SHA-256', await item.file.arrayBuffer());
      manifest.push({ path: item.path, size: item.file.size,
        sha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''),
        content_type: item.file.type || 'application/octet-stream' });
    }
    upload.folderManifest = manifest;
  }
  upload.importKey ??= `${Date.now()}.${crypto.randomUUID()}`;
  const status = upload.folderStatusUrl
    ? await api<ImportStatus>(upload.folderStatusUrl)
    : await api<ImportStatus>(`/account/sites/${encodeURIComponent(siteId)}/deployments`, jsonBody('POST', {
      mode: 'replace', expected_version: site.content_generation ?? 0, idempotency_key: upload.importKey, files: upload.folderManifest,
    }));
  upload.folderStatusUrl = statusPath(status.status_url);
  const missing = new Set(status.progress?.missing_paths ?? files.map(item => item.path));
  let uploaded = files.length - missing.size;
  for (const item of files) {
    if (!missing.has(item.path)) continue;
    hooks.onProgress?.({ phase: 'uploading', text: `Uploading files: ${uploaded} of ${files.length}` });
    await api(`${upload.folderStatusUrl}/files/${item.path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT', headers: { 'content-type': item.file.type || 'application/octet-stream' }, body: item.file,
    });
    uploaded++;
  }
  // Reload recovery is safe only after the session no longer needs local File objects.
  upload.pendingImport = { siteId, slug, statusUrl: upload.folderStatusUrl };
  rememberImport(upload.pendingImport, hooks);
}

type PublishOptions = { password: string; write_password: string; ttl: string; write_policy: string };

/** Raw bodies go past the server's multipart cap (IN_MEMORY_BYTES). Header values must be printable ASCII to survive as-is. */
function rawUploadHeaders(file: File, filename: string, options: PublishOptions): Record<string, string> | null {
  if (![options.password, options.write_password].every(value => /^[\x20-\x7e]*$/.test(value))) return null;
  const headers: Record<string, string> = { 'content-type': file.type || 'application/octet-stream', 'x-filename': filename };
  if (options.password) headers['x-energon-set-password'] = options.password;
  if (options.write_password) headers['x-energon-set-write-password'] = options.write_password;
  if (options.ttl) headers['x-energon-ttl'] = options.ttl;
  if (options.write_policy) headers['x-energon-write-policy'] = options.write_policy;
  return headers;
}

export async function publish(upload: StagedUpload, options: PublishOptions, hooks: PublishHooks = {}): Promise<PublishResult> {
  if (upload.kind === 'loose' && upload.file) {
    const filename = safeFilename(upload.filename, upload.file.name);
    const headers = rawUploadHeaders(upload.file, filename, options);
    if (headers) return api('/account/files', { method: 'POST', headers, body: upload.file });
    const form = new FormData();
    form.set('file', upload.file, filename);
    if (options.password) form.set('password', options.password);
    if (options.write_password) form.set('write_password', options.write_password);
    if (options.ttl) form.set('ttl', options.ttl);
    if (options.write_policy) form.set('write_policy', options.write_policy);
    return api('/account/files', { method: 'POST', body: form });
  }
  const slug = slugify(upload.slug);
  const siteBody: Record<string, unknown> = { slug, ttl: options.ttl, write_policy: options.write_policy };
  if (options.password) siteBody.password = options.password;
  if (options.write_password) siteBody.write_password = options.write_password;
  const site = upload.createdSite ?? await api<PublishResult>('/account/sites', jsonBody('POST', siteBody));
  upload.createdSite = site;
  const siteId = site.id || slug;
  try {
    if (upload.kind === 'zip') {
      if (!upload.pendingImport) {
        hooks.onProgress?.({ phase: 'uploading', text: 'Uploading ZIP…' });
        upload.importKey ??= `${Date.now()}.${crypto.randomUUID()}`;
        const status = await api<ImportStatus>(`/account/sites/${encodeURIComponent(siteId)}/import`, {
          method: 'POST', headers: { 'content-type': 'application/zip', prefer: 'respond-async', 'idempotency-key': upload.importKey }, body: upload.file,
        });
        upload.pendingImport = { siteId, slug, statusUrl: statusPath(status.status_url) };
        rememberImport(upload.pendingImport, hooks);
      }
      const imported = await resumeImport(upload.pendingImport, hooks);
      return { ...imported, password: site.password || options.password, write_password: site.write_password || options.write_password };
    }
    if (!upload.pendingImport) await stageFolder(upload, site, siteId, slug, hooks);
    const imported = await resumeImport(upload.pendingImport!, hooks);
    return { ...imported, password: site.password || options.password, write_password: site.write_password || options.write_password };
  } catch (error) {
    throw new Error(`Publication of “${slug}” paused. ${error instanceof Error ? error.message : 'Try again.'} ${upload.pendingImport ? 'Resume publication to continue this upload.' : 'Retry with the selected files to continue.'}`);
  }
}
