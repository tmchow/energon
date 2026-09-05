import { nextNumberedSlug } from "../slugs";
import { api, jsonBody, RequestError } from './api';

export type UploadFile = { path: string; file: File };
export type StagedUpload = { kind: 'loose' | 'folder' | 'zip'; file?: File; files: UploadFile[]; slug: string; filename: string };
export type PublishResult = { url: string; slug?: string; filename?: string; file_count?: number; password?: string; password_protected?: boolean; written?: string[] };

export function safeFilename(name: string, fallback: string): string {
  const base = String(name || fallback || 'file').replace(/\\/g, '/').split('/').pop() || 'file';
  return base.replace(/[^\w.\- ()[\]]+/g, '-').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 180) || fallback || 'file';
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'site';
}

export async function firstFreeSlug(start: string, origin: string, handle: string): Promise<string> {
  let slug = slugify(start);
  for (let i = 0; i < 50; i++) {
    const response = await fetch(`${origin}/${encodeURIComponent(handle)}/s/${encodeURIComponent(slug)}/`, { headers: { accept: 'application/json' } });
    if (response.status === 404 || response.status === 410) return slug;
    slug = nextNumberedSlug(slug);
  }
  throw new Error('Could not find an available slug. Choose a different name.');
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

export async function publish(upload: StagedUpload, options: { password: string; ttl: string; write_policy: string; overwrite: boolean }): Promise<PublishResult> {
  if (upload.kind === 'loose' && upload.file) {
    const form = new FormData();
    form.set('file', upload.file, safeFilename(upload.filename, upload.file.name));
    if (options.password) form.set('password', options.password);
    if (options.ttl) form.set('ttl', options.ttl);
    if (options.write_policy) form.set('write_policy', options.write_policy);
    return api('/account/files', { method: 'POST', body: form });
  }
  const slug = slugify(upload.slug);
  const settings = options.overwrite ? {} : { ttl: options.ttl, write_policy: options.write_policy };
  const site = await api<PublishResult>('/account/sites', jsonBody('POST', { slug, overwrite: options.overwrite, ...(options.password ? { password: options.password } : {}), ...settings }));
  try {
    if (upload.kind === 'zip') {
      const imported = await api<PublishResult>(`/account/sites/${encodeURIComponent(slug)}/import`, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: upload.file });
      return { ...imported, password: site.password || options.password, file_count: imported.written?.length || 0 };
    }
    const files = stripWrapFiles(upload.files).filter(item => item.path && !item.path.endsWith('/'));
    for (const item of files) {
      await api(`/account/sites/${encodeURIComponent(slug)}/files/${item.path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'PUT', headers: { 'content-type': item.file.type || 'application/octet-stream' }, body: item.file,
      });
    }
    return { ...site, file_count: files.length };
  } catch (error) {
    // A later upload failure must not be mistaken for a create-site collision.
    throw new Error(`Site “${slug}” was created or opened, but uploading its files failed. ${error instanceof Error ? error.message : 'Try again.'}`);
  }
}

export function isCollision(error: unknown): boolean {
  return error instanceof RequestError && error.status === 409;
}
