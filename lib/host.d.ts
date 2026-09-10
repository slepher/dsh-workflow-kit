import type { Context } from "@deepseek-ai/cordis";
export declare const name = "dsh-workflow-kit";
export declare const inject: string[];
export interface Config {
    stateDir: string;
    workflowSkillDir: string;
    implementationStandardDir?: string;
}
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=host.d.ts.map