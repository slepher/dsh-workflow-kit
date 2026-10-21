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

/** The stored coding strategy, as the Host resolves it for dispatch. */
export interface StrategyView {
  /** Stored coding default; the only source, since the composer no longer carries an override. */
  default: CodingStrategy;
  /** Effective coding strategy for the next dispatch in this Session. */
  effective: EffectiveStrategy;
  /** Whether the selected configuration runs sup and def on the same provider and model. */
  sameModel: boolean;
}

/** One model the route's own catalog advertises, in settings-page terms. */
export interface RouteModelView {
  id: string;
  name: string;
  efforts: readonly { id: string; name: string }[];
  defaultEffort?: string;
}

/**
 * One provider group a route publishes for the settings page.
 *
 * The composer model menu can hide a route (`allowMainSession: false`) while
 * workflow roles still have to select it, so the provider exposes its catalog
 * through `ctx.codexExecution` and the page merges these groups in itself.
 */
export interface RouteGroupView {
  provider: string;
  name: string;
  models: readonly RouteModelView[];
}

/** One catalog read on the plugin's own channel: groups the Host model menu may hide. */
export interface RouteCatalogView {
  groups: readonly RouteGroupView[];
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
export type ProfileAction = "configurations" | "catalog" | "profiles" | "select-profile";

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
