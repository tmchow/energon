export class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new RequestError(data.message || `${response.status} ${url}`, response.status);
  return data as T;
}

export function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

export function formatTime(iso?: string | null, local = false): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return iso;
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: local ? undefined : 'UTC' });
}

export function formatExpiry(iso?: string | null, local = false): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  return Number.isNaN(date.valueOf()) ? iso : date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: local ? undefined : 'UTC' });
}
