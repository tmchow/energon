/** Dependency-free `{{KEY}}` renderer shared by scripts/render-skill.mjs and the Worker. */
export function render(template, vars) {
  const missing = new Set();
  const text = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    if (!(key in vars)) {
      missing.add(key);
      return `{{${key}}}`;
    }
    return String(vars[key]);
  });
  if (missing.size) throw new Error(`unknown template keys: ${[...missing].join(", ")}`);
  if (/\{\{[A-Z0-9_]+\}\}/.test(text)) throw new Error("unreplaced template tokens remain");
  return text;
}

/** The `{{KEY}}` map every skill template shares; render-skill adds ORG, which has no runtime source. */
export function skillTemplateVars({
  skill,
  plugin,
  marketplace,
  origin,
  tokenEnv,
  tokenPrefix,
  product,
  marketplaceRepo,
  marketplaceUrl,
  version,
}) {
  let host = origin;
  try {
    host = new URL(origin).host;
  } catch {
    /* keep raw */
  }
  return {
    SKILL_NAME: skill,
    PLUGIN_NAME: plugin,
    MARKETPLACE_NAME: marketplace,
    ORIGIN: origin,
    ORIGIN_HOST: host,
    TOKEN_ENV: tokenEnv,
    TOKEN_PREFIX: tokenPrefix,
    PRODUCT: product,
    MARKETPLACE_REPO: marketplaceRepo,
    MARKETPLACE_URL: marketplaceUrl,
    INSTALL_LINE: `${plugin}@${marketplace}`,
    VERSION: version,
  };
}
