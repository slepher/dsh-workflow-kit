import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER } from "./constants.js";
import { ROLES } from "./roles.js";
import type { Profile } from "./configuration.js";
import type { Effort } from "./types.js";

/**
 * Effort a DeepSeek-class default uses for one codex-class effort. The two
 * adapters label their reasoning range differently, so the shipped pair maps
 * the codex `high`/`medium` split onto DeepSeek's `max`/`high`.
 */
const DEEPSEEK_EFFORT: Record<Effort, Effort> = {
  none: "none",
  minimal: "minimal",
  low: "low",
  medium: "high",
  high: "max",
  xhigh: "max",
  max: "max",
  ultra: "ultra",
};

/** Installer-owned configurations, in the order a picker lists them. */
export const SHIPPED_PROFILES = ["gpt-workflow", "ds-workflow"] as const;

/** One installer-owned configuration id. */
export type ShippedProfileId = (typeof SHIPPED_PROFILES)[number];

/**
 * Build one shipped configuration from the role catalog.
 * @param id - the shipped configuration to build.
 * @returns every role mapped to that configuration's provider, model, and effort.
 */
export function shippedProfile(id: ShippedProfileId): Profile {
  const roles: Profile["roles"] = Object.create(null);
  for (const role of ROLES) {
    roles[role.name] = id === "gpt-workflow"
      ? { provider: role.provider, model: role.model, reasoningEffort: role.effort }
      : { provider: DEEPSEEK_PROVIDER, model: DEEPSEEK_MODEL, reasoningEffort: DEEPSEEK_EFFORT[role.effort] };
  }
  return { roles };
}
