import { DEEPSEEK_MODEL, DEEPSEEK_PROVIDER } from "./constants.js";
import { CONFIG_KEYS, configDefault } from "./roles.js";
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
 * Build one shipped configuration from the configuration-key catalog.
 * @param id - the shipped configuration to build.
 * @returns every key mapped to that configuration's provider, model, and effort.
 */
export function shippedProfile(id: ShippedProfileId): Profile {
  const roles: Profile["roles"] = Object.create(null);
  for (const key of CONFIG_KEYS) {
    const fallback = configDefault(key);
    roles[key] = id === "gpt-workflow"
      ? fallback
      : { provider: DEEPSEEK_PROVIDER, model: DEEPSEEK_MODEL, reasoningEffort: DEEPSEEK_EFFORT[fallback.reasoningEffort] };
  }
  return { roles };
}
