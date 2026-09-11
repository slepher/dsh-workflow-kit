import { join } from "node:path";
import type { ResolvedRole, Role } from "./types.js";
import { assertPromptSkills, getPromptSkill } from "./prompts.js";

export const ROLES: readonly Role[] = [
  { name: "planner", description: "Planner for progressive generations and executable contracts.", model: "gpt-6-astra", effort: "high", protocol: "planner.md", implementation: false, skills: ["worker-execution", "role-planner", "implementation-simplicity"] },
  { name: "reviewer", description: "Independent reviewer for contract-bound candidates.", model: "gpt-5.6-sol", effort: "high", protocol: "reviewer.md", implementation: false, skills: ["worker-execution", "role-reviewer", "implementation-simplicity"] },
  { name: "context_collector", description: "Read-only repository evidence collector.", model: "gpt-5.6-luna", effort: "high", protocol: "context-collector.md", implementation: false, skills: ["worker-execution", "role-context-collector"] },
  { name: "def_coding_worker", description: "Default implementation and unit-test worker.", model: "gpt-5.6-luna", effort: "medium", protocol: "def-coding-worker.md", implementation: true, skills: ["worker-execution", "role-def-coding-worker", "implementation-simplicity"] },
  { name: "sup_coding_worker", description: "Higher-capability implementation worker.", model: "gpt-5.6-sol", effort: "medium", protocol: "sup-coding-worker.md", implementation: true, skills: ["worker-execution", "role-sup-coding-worker", "implementation-simplicity"] },
  { name: "evidence_runner", description: "Mechanical evidence runner without source edits.", model: "gpt-5.6-luna", effort: "medium", protocol: "evidence-runner.md", implementation: false, skills: ["worker-execution", "role-evidence-runner"] },
  { name: "full_tester", description: "Independent full-validation worker.", model: "gpt-5.6-luna", effort: "medium", protocol: "full-tester.md", implementation: false, skills: ["worker-execution", "role-full-tester"] },
];

assertPromptSkills(ROLES.flatMap(role => role.skills ?? []));

export function listRoles(): readonly Role[] { return ROLES; }

export function resolveRole(name: string, workflowSkillDir?: string, implementationStandardDir?: string): ResolvedRole {
  const role = ROLES.find(candidate => candidate.name === name);
  if (!role) throw new Error(`Unknown DSH role: ${name}`);
  const roleProtocolPath = workflowSkillDir ? join(workflowSkillDir, "references", "roles", role.protocol) : `the installed codex-workflow skill's references/roles/${role.protocol}`;
  const standardPath = implementationStandardDir ? join(implementationStandardDir, "SKILL.md")
    : workflowSkillDir ? join(workflowSkillDir, "..", "audit-implementation-simplicity", "SKILL.md")
    : "the installed audit-implementation-simplicity skill's SKILL.md";
  const developerInstructions = (role.skills ?? []).map(skill => {
    return getPromptSkill(skill).content.replaceAll("{{roleProtocolPath}}", roleProtocolPath).replaceAll("{{implementationStandardPath}}", standardPath).trim();
  }).join("\n\n");
  return { ...role, developerInstructions };
}
