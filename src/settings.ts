import z from "@deepseek-ai/schemastery";
import type { WorkflowSettingsSection } from "./profile-types.js";
import { WORKFLOW_SETTINGS_NAMESPACE } from "./constants.js";
import { DEFAULT_CODING_STRATEGY, DEFAULT_INTEGRATE_STRATEGY, STRATEGIES } from "./constants.js";

export { WORKFLOW_SETTINGS_NAMESPACE };

/** Every reasoning effort a stored role override may name. */
export const SETTINGS_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;

/**
 * The `dsh-workflow-kit` settings namespace. Role maps are sparse: a key a
 * stored configuration omits keeps its installed value, then the shipped key
 * default. `defaultConfig` empty defers to the entry config's `defaultProfile`.
 * `codingStrategy` and `integrateStrategy` are stored separately and neither
 * overwrites the other.
 */
export type WorkflowSettings = WorkflowSettingsSection;

/**
 * Every live-editable field of the plugin's `Config`, as one field map.
 *
 * `.volatile()` is what lets the configuration form edit a field without
 * remounting the plugin: the parsed value becomes a stable reference whose
 * current snapshot the consumers read at use time. `host.ts` owns the rest of
 * `Config` and spreads this map into it, so the fields are declared once.
 */
export const WorkflowConfigFields = {
  defaultConfig: z.string().default("").volatile(),
  codingStrategy: z.union([...STRATEGIES]).default(DEFAULT_CODING_STRATEGY).volatile(),
  integrateStrategy: z.union([...STRATEGIES]).default(DEFAULT_INTEGRATE_STRATEGY).volatile(),
  configs: z.dict(z.object({
    roles: z.dict(z.object({
      provider: z.string(),
      model: z.string(),
      reasoningEffort: z.union([...SETTINGS_EFFORTS]),
    })),
  })).default({}).volatile(),
};

/**
 * The same fields as one standalone schema. Schemastery widens every dict
 * member to optional in its inferred type, so the schema is asserted to the
 * section type it resolves at runtime.
 */
export const WorkflowSettingsSchema = z.object(WorkflowConfigFields) as unknown as z<WorkflowSettings>;
