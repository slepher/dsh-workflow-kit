import z from "@deepseek-ai/schemastery";
import type { WorkflowSettingsSection } from "./profile-types.js";
import { WORKFLOW_SETTINGS_NAMESPACE } from "./constants.js";

export { WORKFLOW_SETTINGS_NAMESPACE };

/** Every reasoning effort a stored role override may name. */
export const SETTINGS_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;

/**
 * The `dsh-workflow-kit` settings namespace. Role maps are sparse: a role a
 * stored configuration omits keeps its installed value, then the shipped role
 * default. `defaultConfig` empty defers to the entry config's `defaultProfile`.
 */
export type WorkflowSettings = WorkflowSettingsSection;

/**
 * Schema resolving the `dsh-workflow-kit` namespace. Schemastery widens every
 * dict member to optional in its inferred type, so the schema is asserted to
 * the section type it resolves at runtime.
 */
export const WorkflowSettingsSchema = z.object({
  defaultConfig: z.string().default(""),
  configs: z.dict(z.object({
    roles: z.dict(z.object({
      provider: z.string(),
      model: z.string(),
      reasoningEffort: z.union([...SETTINGS_EFFORTS]),
    })),
  })).default({}),
}) as unknown as z<WorkflowSettings>;
