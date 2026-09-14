export {
  WORKFLOW_PLUGIN_ID, WORKFLOW_SETTINGS_NAMESPACE, STRATEGIES, DEFAULT_CODING_STRATEGY, DEFAULT_INTEGRATE_STRATEGY,
  isStrategy,
} from "./constants.js";
export type { CodingStrategy, EffectiveStrategy } from "./constants.js";

export const WORKFLOW_OWNED_STATE = [
  "tasks",
  "attempts",
  "lanes",
  "reviews",
  "integration",
  "delivery",
  "release",
] as const;

export { listRoles, resolveRole, ROLES, CONFIG_KEYS, CODING_WORKER, configDefault, isExecutionRole } from "./roles.js";
export { WorkflowStore } from "./store.js";
export { WorkflowWorkers } from "./workers.js";
export type { BoundStrategy, Capture, ContinueWithRoute, ControlOutcome, HandoffRecord, NativeChildRecord, ReportUsage, WorkerProjection } from "./workers.js";
export { handoffPrompt, parseControlSignal } from "./control.js";
export type { ConsultSignal, ControlSignal, ControlTier, HandoffSignal } from "./control.js";
export { Workflow, type WorkflowAction } from "./workflow.js";
export { apply, inject, name, type Config } from "./host.js";
export type * from "./types.js";

export { bindCodingStrategy, bindIntegrateStrategy, sameModel, snapshotProfile, tierConfigKey } from "./strategy.js";
export type { CodingPhase, StrategyBinding, Tier } from "./strategy.js";
export { WorkflowConfiguration, loadBuiltinProfiles, parseProfile, roleInstructions } from "./configuration.js";
export type { BuiltinProfiles, CaptureOptions, Profile, RoleExecution, RoleInput, RoleInstructions } from "./configuration.js";
export { SHIPPED_PROFILES, shippedProfile } from "./profiles.js";
export type { ShippedProfileId } from "./profiles.js";
export { SETTINGS_EFFORTS, WorkflowSettingsSchema } from "./settings.js";
export type { WorkflowSettings } from "./settings.js";
export type {
  CatalogView, ConfigView, ConfigurationsView, ProfileAction, ProfileView, RoleView,
  StoredRoleValue, StrategyView, WorkflowSettingsSection,
} from "./profile-types.js";
