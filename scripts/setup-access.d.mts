export interface AccessConfig {
  account_id: string;
  hub_hostname: string;
  content_hostname: string;
  identity_provider_id: string;
  allowed_emails: string[];
}
export type AccessClient = (path: string, method?: string, body?: unknown) => Promise<{ result: unknown; result_info?: { total_pages?: number } }>;
export interface AccessPlan {
  account_id: string;
  hub: string;
  content: string;
  provider: { id: string; name: string; type: string };
  allowed_emails: string[];
  resources: { app: string; app_action: "create" | "reuse"; policy_action: "create" | "reuse" }[];
}
export function validateConfig(input: unknown): AccessConfig;
export function cloudflareClient(token?: string): AccessClient;
export function setupAccess(config: unknown, client: AccessClient, apply?: boolean, report?: (event: unknown) => void): Promise<
  | { applied: false; plan: AccessPlan }
  | { applied: true; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; application_ids: string[]; policy_ids: string[] }
>;
