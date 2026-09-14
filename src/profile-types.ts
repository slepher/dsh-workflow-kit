/** Browser projection of the workflow configuration catalog; developer instructions remain Host-side. */
import type { CodingStrategy, EffectiveStrategy } from "./constants.js";

/** One configuration key's effective execution inputs, plus whether the user layer overrides it. */
export interface RoleView {
  provider: string;
  model: string;
  reasoningEffort: string;
  overridden: boolean;
}

/** One configuration the picker and the settings page list. */
export interface ConfigView {
  id: string;
  /** Whether an installer-owned file defines this configuration. */
  builtin: boolean;
  /** Whether this configuration's sup and def coding entries share one provider and model. */
  sameModel: boolean;
  roles: Record<string, RoleView>;
  missingRequiredRoles: string[];
}

/** Effective configurations plus the fixed configuration-key catalog. */
export interface CatalogView {
  configs: ConfigView[];
  roleNames: string[];
  /** Profile keys carrying the two coding model configurations. */
  codingKeys: { def: string; sup: string };
  /** Stored strategy defaults. */
  strategies: { coding: CodingStrategy; integrate: CodingStrategy };
}

/** Session-scoped coding strategy facts the composer needs, resolved by the Host. */
export interface StrategyView {
  /** Session coding override; null when the Session inherits the stored default. */
  preference: CodingStrategy | null;
  /** Stored coding default that applies when the Session names none. */
  default: CodingStrategy;
  /** Effective coding strategy for the next dispatch in this Session. */
  effective: EffectiveStrategy;
  /** Whether the selected configuration runs sup and def on the same provider and model. */
  sameModel: boolean;
  /** Whether the profile fixes independent execution, so the composer control is hidden. */
  fixed: boolean;
}

/** Session-scoped read: the catalog plus that native Session's recorded selection and strategy. */
export interface ProfileView extends CatalogView {
  selectedProfile: string | null;
  strategy: StrategyView;
}

/** Settings-page read: the catalog plus the stored new-Session default. */
export interface ConfigurationsView extends CatalogView {
  defaultConfig: string | null;
}

/** Endpoints the browser half calls on the `/workflow` channel. */
export type ProfileAction = "configurations" | "profiles" | "select-profile" | "select-strategy";

/** One stored role override as this browser writes it. */
export type StoredRoleValue = { provider: string; model: string; reasoningEffort: string };

/**
 * The `dsh-workflow-kit` settings section as the browser writes it. Role maps
 * are sparse, so a key this section omits keeps its installed value. The two
 * strategies are stored independently and never overwrite each other.
 */
export interface WorkflowSettingsSection {
  defaultConfig: string;
  codingStrategy: CodingStrategy;
  integrateStrategy: CodingStrategy;
  configs: Record<string, { roles: Record<string, StoredRoleValue> }>;
}
