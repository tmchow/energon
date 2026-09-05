import { DEFAULT_PUBLIC_ORIGIN, ENV_TOKEN, PRODUCT, TOKEN_PREFIX } from "./config";
import type { Env } from "./types";

/** Names committed in this git tree (instance-skill.json / plugins/). */
export const REPO_SKILL = "energon";
export const REPO_MARKETPLACE = "energon";
export const REPO_MARKETPLACE_REPO = "tmchow/energon";

export type { InstanceIdentity } from "./page-data";
import type { InstanceIdentity } from "./page-data";

/**
 * Runtime identity for one deployed Worker. Must match the skill committed
 * under plugins/ after a fork runs `npm run skill:init`.
 */
export function identityFromEnv(
  env: Partial<
    Pick<Env, "MARKETPLACE_NAME" | "MARKETPLACE_REPO" | "SKILL_NAME" | "TOKEN_ENV" | "TOKEN_PREFIX" | "PUBLIC_ORIGIN">
  >,
): InstanceIdentity {
  const skill = (env.SKILL_NAME || "").trim() || REPO_SKILL;
  const marketplace = (env.MARKETPLACE_NAME || "").trim() || REPO_MARKETPLACE;
  const repo = (env.MARKETPLACE_REPO || "").trim() || REPO_MARKETPLACE_REPO;
  const tokenEnv = (env.TOKEN_ENV || "").trim() || ENV_TOKEN;
  const tokenPrefix = (env.TOKEN_PREFIX || "").trim() || TOKEN_PREFIX;
  const origin = (env.PUBLIC_ORIGIN || "").replace(/\/$/, "") || DEFAULT_PUBLIC_ORIGIN;
  return {
    skill,
    plugin: skill,
    marketplace,
    repo,
    tokenEnv,
    tokenPrefix,
    origin,
  };
}

export function installLine(id: InstanceIdentity): string {
  return `${id.plugin}@${id.marketplace}`;
}

export function identityPublic(id: InstanceIdentity): Record<string, unknown> {
  return {
    product: PRODUCT,
    origin: id.origin,
    skill: id.skill,
    plugin: id.plugin,
    marketplace: id.marketplace,
    repo: id.repo,
    install: installLine(id),
    env: id.tokenEnv,
    token_prefix: id.tokenPrefix,
  };
}
