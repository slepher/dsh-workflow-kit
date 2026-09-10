import { join } from "node:path";
export const ROLES = [
    { name: "planner", description: "Planner for progressive generations and executable contracts.", model: "gpt-6-astra", effort: "high", protocol: "planner.md", implementation: false },
    { name: "reviewer", description: "Independent reviewer for contract-bound candidates.", model: "gpt-5.6-sol", effort: "high", protocol: "reviewer.md", implementation: false },
    { name: "context_collector", description: "Read-only repository evidence collector.", model: "gpt-5.6-luna", effort: "high", protocol: "context-collector.md", implementation: false },
    { name: "def_coding_worker", description: "Default implementation and unit-test worker.", model: "gpt-5.6-luna", effort: "medium", protocol: "def-coding-worker.md", implementation: true },
    { name: "sup_coding_worker", description: "Higher-capability implementation worker.", model: "gpt-5.6-sol", effort: "medium", protocol: "sup-coding-worker.md", implementation: true },
    { name: "evidence_runner", description: "Mechanical evidence runner without source edits.", model: "gpt-5.6-luna", effort: "medium", protocol: "evidence-runner.md", implementation: false },
    { name: "full_tester", description: "Independent full-validation worker.", model: "gpt-5.6-luna", effort: "medium", protocol: "full-tester.md", implementation: false },
];
export function listRoles() { return ROLES; }
export function resolveRole(name, workflowSkillDir, implementationStandardDir) {
    const role = ROLES.find(candidate => candidate.name === name);
    if (!role)
        throw new Error(`Unknown DSH role: ${name}`);
    if (!workflowSkillDir)
        throw new Error("workflowSkillDir is required for role execution");
    const roleProtocolPath = join(workflowSkillDir, "references", "roles", role.protocol);
    const standard = implementationStandardDir ?? join(workflowSkillDir, "..", "audit-implementation-simplicity");
    const developerInstructions = `${WORKER_EXECUTION}\n\n${ROLE_INSTRUCTIONS[role.name]}\n\nFor managed workflow assignments, read the complete role protocol at ${roleProtocolPath}. If it is absent, unreadable, or names another role, return Status: role_protocol_blocked and stop.` +
        (role.implementation ? `\n\nImplementation standard: ${join(standard, "SKILL.md")}; load only for the modes named in the role protocol.` : "");
    return { ...role, developerInstructions };
}
const WORKER_EXECUTION = `Complete only the assignment authorized for your role. Continue within scope until completion, blocking, or checkpoint. Preserve other work and do not spawn children. Ordinary delegation has no automatic commit permission. Managed coding tasks commit only their assigned lane when explicitly dispatched. Return the complete result in the final reply; write extra reports and artifacts only to assigned paths. Use assigned resources and writable roots. On insufficient resources, report the blocked step, evidence, needed resources, completed work, and still-running processes. Never read or request the dispatcher-only codex-workflow/SKILL.md.`;
const ROLE_INSTRUCTIONS = {
    planner: "Own planning semantics, task boundaries, and revisions. Do not implement, merge, or accept results.",
    reviewer: "Independently judge the assigned candidate and return the requested identity-bound verdict. Do not implement or merge.",
    context_collector: "Investigate the bounded question read-only and return source locations, evidence, and unresolved facts.",
    def_coding_worker: "Complete investigation, implementation, focused validation, and in-scope correction within owned paths.",
    sup_coding_worker: "Complete the hard implementation assignment, focused validation, and in-scope correction within owned paths.",
    evidence_runner: "Run assigned commands and comparisons without product edits; return commands, cwd, exits, and evidence.",
    full_tester: "Independently validate the fixed candidate with assigned isolated resources; do not edit product code or tests.",
};
//# sourceMappingURL=roles.js.map