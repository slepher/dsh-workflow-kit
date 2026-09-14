export const WORKFLOW_PLUGIN_ID = "dsh-workflow-kit";

/** Settings namespace that carries user-authored workflow configurations. */
export const WORKFLOW_SETTINGS_NAMESPACE = WORKFLOW_PLUGIN_ID;

/** Provider serving the shipped `gpt-workflow` defaults. */
export const CODEX_PROVIDER = "codex";

/** Provider and model serving every role in the shipped `ds-workflow` defaults. */
export const DEEPSEEK_PROVIDER = "deepseek-official";
export const DEEPSEEK_MODEL = "deepseek-flash";

/**
 * Profile configuration keys carrying the two coding model configurations.
 * These keys stay stable so existing Profile files and stored user overrides
 * keep their models; both are consumed by the single `coding_worker`
 * execution role, and the bound strategy decides which one runs.
 */
export const CODING_CONFIG_KEY = { def: "def_coding_worker", sup: "sup_coding_worker" } as const;

/**
 * Strategies a user or Session may choose for coding or integration work. They
 * live here, in the dependency-free constants module, because the browser half
 * renders the same closed option set without pulling Host-side modules into
 * its bundle.
 */
export const STRATEGIES = ["economy", "adaptive", "bootstrap", "expert"] as const;

/** One user-selectable execution strategy. */
export type CodingStrategy = (typeof STRATEGIES)[number];

/** A resolved strategy; `independent` is the derived single-configuration case. */
export type EffectiveStrategy = CodingStrategy | "independent";

/** Default coding strategy for a Session that names none. */
export const DEFAULT_CODING_STRATEGY: CodingStrategy = "adaptive";

/** Default integration strategy; `economy` is def running independently. */
export const DEFAULT_INTEGRATE_STRATEGY: CodingStrategy = "economy";

/** Whether a value is one of the four selectable strategies. */
export function isStrategy(value: unknown): value is CodingStrategy {
  return typeof value === "string" && (STRATEGIES as readonly string[]).includes(value);
}
