import type { ResolvedRole, Role } from "./types.js";
export declare const ROLES: readonly Role[];
export declare function listRoles(): readonly Role[];
export declare function resolveRole(name: string, workflowSkillDir: string, implementationStandardDir?: string): ResolvedRole;
//# sourceMappingURL=roles.d.ts.map