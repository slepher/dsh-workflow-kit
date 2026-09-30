import { join } from "node:path";
import type { Effort, ResolvedRole, Role } from "./types.js";
import { assertPromptSkills, getPromptSkill } from "./prompts.js";
import { CODEX_PROVIDER, CODING_CONFIG_KEY } from "./constants.js";

/**
 * The unified execution role every coding assignment runs as. Profile sup/def
 * entries are model configurations for this one role, not separate roles, and
 * the bound strategy decides which configuration runs.
 */
export const CODING_WORKER = "coding_worker";

/** Model configuration the shipped def tier falls back to. */
const DEF_CODING = { provider: CODEX_PROVIDER, model: "gpt-6-luna", effort: "medium" as Effort };

/** Model configuration the shipped sup tier falls back to. */
const SUP_CODING = { provider: CODEX_PROVIDER, model: "gpt-6.1-sol", effort: "medium" as Effort };

/**
 * Execution role catalog: the `Role` a contract may name, and the roles the
 * dispatch tool can start. Coding assignments always use `coding_worker`; the
 * model that serves it comes from the Profile configuration the strategy binds.
 */
export const ROLES: readonly Role[] = [
  { name: "planner", description: "Planner for progressive generations and executable contracts.", provider: CODEX_PROVIDER, model: "gpt-6-astra", effort: "high", protocol: "planner.md", implementation: false, skills: ["worker-execution", "role-planner", "implementation-simplicity"] },
  { name: "reviewer", description: "Independent reviewer for contract-bound candidates.", provider: CODEX_PROVIDER, model: "gpt-6.1-sol", effort: "high", protocol: "reviewer.md", implementation: false, skills: ["worker-execution", "role-reviewer", "implementation-simplicity"] },
  { name: "context_collector", description: "Read-only repository evidence collector.", provider: CODEX_PROVIDER, model: "gpt-6-luna", effort: "high", protocol: "context-collector.md", implementation: false, skills: ["worker-execution", "role-context-collector"] },
  { name: CODING_WORKER, description: "Unified implementation, test and in-scope repair worker.", ...DEF_CODING, protocol: "coding-worker.md", implementation: true, skills: ["worker-execution", "role-coding-worker", "implementation-simplicity"] },
  { name: "evidence_runner", description: "Mechanical evidence runner without source edits.", provider: CODEX_PROVIDER, model: "gpt-6-luna", effort: "medium", protocol: "evidence-runner.md", implementation: false, skills: ["worker-execution", "role-evidence-runner"] },
  { name: "full_tester", description: "Independent full-validation worker.", provider: CODEX_PROVIDER, model: "gpt-6-luna", effort: "medium", protocol: "full-tester.md", implementation: false, skills: ["worker-execution", "role-full-tester"] },
];

/**
 * Profile configuration-key catalog: the keys a shipped Profile, a stored user
 * override, and the settings page carry. The legacy `def_coding_worker` /
 * `sup_coding_worker` keys stay, so existing model configuration needs no
 * migration; they are configuration keys, not execution roles.
 */
export const CONFIG_KEYS: readonly string[] = [
  "planner", "reviewer", "context_collector", CODING_CONFIG_KEY.def, CODING_CONFIG_KEY.sup, "evidence_runner", "full_tester",
];

/** Shipped model configuration for one Profile key. */
export function configDefault(key: string): { provider: string; model: string; reasoningEffort: Effort } {
  if (key === CODING_CONFIG_KEY.def) return { provider: DEF_CODING.provider, model: DEF_CODING.model, reasoningEffort: DEF_CODING.effort };
  if (key === CODING_CONFIG_KEY.sup) return { provider: SUP_CODING.provider, model: SUP_CODING.model, reasoningEffort: SUP_CODING.effort };
  const role = ROLES.find(candidate => candidate.name === key);
  if (role === undefined) throw new Error(`Unknown workflow configuration key: ${key}`);
  return { provider: role.provider, model: role.model, reasoningEffort: role.effort };
}

assertPromptSkills(ROLES.flatMap(role => role.skills ?? []));

export function listRoles(): readonly Role[] { return ROLES; }

/** Whether a name is an execution role a contract may bind. */
export function isExecutionRole(name: string): boolean {
  return ROLES.some(role => role.name === name);
}

/**
 * Compose one execution role's developer instructions.
 * @param name - execution role name.
 * @param workflowSkillDir - installed external skill directory.
 * @param implementationStandardDir - installed implementation-standard directory.
 * @param extraSkills - phase prompt skills appended after the role's own, in order.
 * @returns the resolved role, including its composed instructions.
 */
export function resolveRole(name: string, workflowSkillDir?: string, implementationStandardDir?: string, extraSkills: readonly string[] = []): ResolvedRole {
  const role = ROLES.find(candidate => candidate.name === name);
  if (!role) throw new Error(`Unknown DSH role: ${name}`);
  const roleProtocolPath = workflowSkillDir ? join(workflowSkillDir, "references", "roles", role.protocol) : `the installed codex-workflow skill's references/roles/${role.protocol}`;
  const standardPath = implementationStandardDir ? join(implementationStandardDir, "SKILL.md")
    : workflowSkillDir ? join(workflowSkillDir, "..", "audit-implementation-simplicity", "SKILL.md")
    : "the installed audit-implementation-simplicity skill's SKILL.md";
  const developerInstructions = [...(role.skills ?? []), ...extraSkills].map(skill => {
    return getPromptSkill(skill).content.replaceAll("{{roleProtocolPath}}", roleProtocolPath).replaceAll("{{implementationStandardPath}}", standardPath).trim();
  }).join("\n\n");
  return { ...role, developerInstructions };
}
