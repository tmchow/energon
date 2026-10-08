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
