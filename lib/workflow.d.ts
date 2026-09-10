import type { Workers } from './workers.js';
import type { Boundary } from './types.js';
type Lane = {
    name: string;
    path: string;
    owner?: string;
};
export type WorkflowAction = {
    action: string;
    generation?: string;
    task?: string;
    attempt?: number;
    lane?: string;
    base?: string;
    result?: string;
    text?: string;
    recipient?: string;
    processesStopped?: boolean;
};
/** Contract state is serialized alongside the existing worker service and directory lock. */
export declare class Workflow {
    readonly workers: Workers;
    readonly skillRoot?: string | undefined;
    private runs;
    private directory;
    private queue;
    constructor(workers: Workers, skillRoot?: string | undefined);
    private save;
    private syncLanes;
    private python;
    private git;
    private commit;
    private retain;
    private clean;
    private ancestor;
    private paths;
    private worktreeTree;
    private overlaps;
    private role;
    private start;
    private capacity;
    private scoped;
    private resultDirectory;
    private artifacts;
    private ports;
    private report;
    private verdict;
    private review;
    private current;
    private attempt;
    private summary;
    execute(parent: string, input: WorkflowAction): Promise<{
        id: string;
        generation: string;
        revision: number;
        workflowSkillDir: string | undefined;
        file: string;
        ready: string[];
        lanes: Lane[];
        tasks: {
            task: string;
            attempt: number;
            state: "accepted" | "running" | "unknown" | "reserved" | "candidate" | "delivered" | "archived" | "released" | "blocked";
            supersededRevision: number | undefined;
            workerId: string;
            turnId: string | undefined;
            lane: string | undefined;
            allocation: (Boundary & {
                ports: Record<string, number>;
            }) | undefined;
            base: string;
            candidate: string | undefined;
            result: string | undefined;
            review: {
                worker: string;
                turn: string | undefined;
                verdict: string | undefined;
            } | undefined;
            integration: {
                id: string;
                target: string;
                candidate: string | undefined;
                conflict: boolean;
                reviewer: string | undefined;
                verdict: string | undefined;
                resolution: string | undefined;
                error: string | undefined;
            } | undefined;
            error: string | undefined;
        }[];
    } | {
        workflowSkillDir: string | undefined;
        adopted: boolean;
    }>;
    private action;
    private dispatch;
    private integrate;
}
export {};
//# sourceMappingURL=workflow.d.ts.map