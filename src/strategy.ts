/**
 * Coding and integrate execution strategies.
 *
 * A strategy is not a permission level: it decides which Profile model
 * configuration runs, whether the execution may switch tiers or ask for
 * bounded expert judgment, and which phase prompt the Host binds. The
 * execution role stays `coding_worker` throughout.
 */
import type { Profile, RoleInput } from "./configuration.js";
import {
  CODING_CONFIG_KEY, DEFAULT_CODING_STRATEGY, DEFAULT_INTEGRATE_STRATEGY, isStrategy, STRATEGIES,
  type CodingStrategy, type EffectiveStrategy,
} from "./constants.js";

export {
  DEFAULT_CODING_STRATEGY, DEFAULT_INTEGRATE_STRATEGY, isStrategy, STRATEGIES,
  type CodingStrategy, type EffectiveStrategy,
};

/** Profile configuration tier one execution runs on. */
export type Tier = "def" | "sup";

/** The phase prompt bound to the current execution stage. */
export type CodingPhase = "main" | "opening" | "continuation" | "consultation";

/**
 * Whether a Profile's sup and def coding entries resolve to the same provider
 * and model. Effort is deliberately ignored: identical models have no model to
 * hand off to.
 */
export function sameModel(profile: Profile | undefined): boolean {
  const def = profile?.roles[CODING_CONFIG_KEY.def], sup = profile?.roles[CODING_CONFIG_KEY.sup];
  return def !== undefined && sup !== undefined && def.provider === sup.provider && def.model === sup.model;
}

/** One execution's resolved strategy: what runs now, what it may do next, and its phase prompts. */
export interface StrategyBinding {
  /** The strategy a Session or setting explicitly named; kept while a preference is inert. */
  requested: CodingStrategy;
  /** The strategy this execution actually follows. */
  effective: EffectiveStrategy;
  /** Whether sup and def resolve to the same provider and model. */
  sameModel: boolean;
  /** Profile configuration tier this phase runs on. */
  tier: Tier;
  /** Whether this execution may hand off to the other tier in the same thread. */
  handoff: boolean;
  /** Whether this execution may request one bounded expert consultation. */
  consult: boolean;
  /** Current phase. */
  phase: CodingPhase;
  /** Prompt skills the Host appends for this execution, in order. */
  prompts: readonly string[];
}

/**
 * Resolve the strategy one coding execution follows.
 *
 * Same-model Profiles are configuration-derived: both coding strategies are
 * inert, def runs the whole assignment independently, and no upgrade, handoff
 * or consultation is authorized. That is a derived behaviour, not a fifth
 * selectable strategy.
 *
 * @param profile - the bound Profile snapshot; `undefined` only during setup reads.
 * @param requested - the explicit preference, if any; omitted means the coding default.
 * @param phase - the execution phase the Host binds.
 * @returns the binding recorded with the execution.
 */
export function bindCodingStrategy(profile: Profile | undefined, requested: CodingStrategy | undefined | null, phase: CodingPhase = "main"): StrategyBinding {
  const preference = requested ?? DEFAULT_CODING_STRATEGY;
  const shared = sameModel(profile);
  const base = { requested: preference, sameModel: shared, phase };
  if (phase === "consultation") {
    return { ...base, effective: "independent", tier: "sup", handoff: false, consult: false, prompts: ["coding-consultation"] };
  }
  if (shared) {
    return { ...base, effective: "independent", tier: "def", handoff: false, consult: false, prompts: ["coding-independent"] };
  }
  if (preference === "expert") {
    return { ...base, effective: "independent", tier: "sup", handoff: false, consult: false, prompts: ["coding-independent"] };
  }
  if (preference === "economy") {
    return { ...base, effective: "independent", tier: "def", handoff: false, consult: false, prompts: ["coding-independent"] };
  }
  if (preference === "adaptive") {
    return { ...base, effective: "adaptive", tier: "def", handoff: false, consult: true, prompts: ["coding-adaptive"] };
  }
  return phase === "continuation"
    ? { ...base, effective: "bootstrap", tier: "def", handoff: false, consult: true, prompts: ["coding-bootstrap-continuation", "coding-adaptive"] }
    : { ...base, effective: "bootstrap", tier: "sup", handoff: true, consult: false, prompts: ["coding-bootstrap-opening"] };
}

/**
 * Resolve the strategy one integration's model work follows. It reads the
 * integrate setting, never a Session coding override; the assigned role keeps
 * its own responsibility and permissions.
 *
 * @param profile - the Profile snapshot bound to this integration.
 * @param requested - the integrate strategy captured when the integration was prepared.
 * @param phase - the integration phase.
 * @returns the binding recorded with the integration.
 */
export function bindIntegrateStrategy(profile: Profile | undefined, requested: CodingStrategy | undefined | null, phase: CodingPhase = "main"): StrategyBinding {
  const binding = bindCodingStrategy(profile, requested ?? DEFAULT_INTEGRATE_STRATEGY, phase);
  // Integration phase wording is role-scoped: the coding phase texts name the
  // coding assignment they belong to, so only the integrate strategy text is
  // bound here.
  return { ...binding, prompts: ["integrate-execution"] };
}

/** Configuration key one tier runs on. */
export function tierConfigKey(tier: Tier): string {
  return CODING_CONFIG_KEY[tier];
}

/**
 * Present a bound sup/def snapshot as a Profile, so a restarted execution
 * resolves same-model behaviour from the configuration it was dispatched with
 * rather than from a Profile that may since have changed.
 * @param coding - the snapshot captured at dispatch.
 * @returns the equivalent Profile.
 */
export function snapshotProfile(coding: { def: RoleInput; sup: RoleInput }): Profile {
  return { roles: { [CODING_CONFIG_KEY.def]: coding.def, [CODING_CONFIG_KEY.sup]: coding.sup } };
}
