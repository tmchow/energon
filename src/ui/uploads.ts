import { api, jsonBody } from './api';

export type UploadFile = { path: string; file: File };
export type StagedUpload = { kind: 'loose' | 'folder' | 'zip'; file?: File; files: UploadFile[]; slug: string; filename: string };
export type PublishResult = { url: string; id?: string; slug?: string; filename?: string; file_count?: number; password?: string; password_protected?: boolean; write_password?: string; write_password_protected?: boolean; written?: string[] };

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

export async function publish(upload: StagedUpload, options: PublishOptions): Promise<PublishResult> {
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
  const site = await api<PublishResult>('/account/sites', jsonBody('POST', siteBody));
  const siteId = site.id || slug;
  try {
    if (upload.kind === 'zip') {
      const imported = await api<PublishResult>(`/account/sites/${encodeURIComponent(siteId)}/import`, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: upload.file });
      return { ...imported, id: siteId, password: site.password || options.password, file_count: imported.written?.length || 0 };
    }
    const files = stripWrapFiles(upload.files).filter(item => item.path && !item.path.endsWith('/'));
    for (const item of files) {
      await api(`/account/sites/${encodeURIComponent(siteId)}/files/${item.path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'PUT', headers: { 'content-type': item.file.type || 'application/octet-stream' }, body: item.file,
      });
    }
    return { ...site, id: siteId, file_count: files.length };
  } catch (error) {
    throw new Error(`Site “${slug}” was created, but uploading its files failed. ${error instanceof Error ? error.message : 'Try again.'}`);
  }
}
