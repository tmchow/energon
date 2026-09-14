import { api } from './api';
import type { CatalogData } from './types';

type Tool = { name: string; description: string; inputSchema: object; execute: () => Promise<unknown> };
type ModelContext = { registerTool: (tool: Tool) => void; unregisterTool?: (name: string) => void };
const LIST_PAGE_CAP = 10;

export function registerHubTools(): () => void {
  const context = (document as Document & { modelContext?: ModelContext }).modelContext
    || (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
  if (!context?.registerTool) return () => {};
  const text = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  context.registerTool({
    name: 'energon_help', description: 'Energon SOP and public API map. Prefer this or GET /v1/help before inventing routes.',
    inputSchema: { type: 'object', properties: {} }, execute: async () => text(await api('/v1/help')),
  });
  context.registerTool({
    name: 'energon_list', description: 'List sites, files, and token labels visible on this signed-in hub. Does not return token secrets.',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const data = await api<CatalogData>('/account/data?limit=50');
      const items = [...data.items];
      for (let cursor = data.cursor, pages = 1; cursor && pages < LIST_PAGE_CAP; pages++) {
        const next = await api<CatalogData>(`/account/data?limit=50&cursor=${encodeURIComponent(cursor)}`);
        items.push(...next.items);
        cursor = next.cursor;
      }
      return text({ email: data.email, total: data.total, sites: items.filter(item => item.kind === 'site'), files: items.filter(item => item.kind === 'file'), tokens: (data.tokens || []).filter(t => !t.revoked).map(t => ({ label: t.label, hint: t.hint || null, recoverable: t.recoverable })) });
    },
  });
  return () => { context.unregisterTool?.('energon_help'); context.unregisterTool?.('energon_list'); };
}
