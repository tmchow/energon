export function render(template: string, vars: Record<string, string | number>): string;

export type SkillTemplateFields = {
  skill: string;
  plugin: string;
  marketplace: string;
  origin: string;
  tokenEnv: string;
  tokenPrefix: string;
  product: string;
  marketplaceRepo: string;
  marketplaceUrl: string;
  version: string;
};

export function skillTemplateVars(fields: SkillTemplateFields): Record<string, string>;
