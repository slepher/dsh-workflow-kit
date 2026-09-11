import type { BackendMutationAction, Caller, CodexBackend, Report as BackendReport, ReportAcceptance, WorkerProjection } from "dsh-codex-kit-backend/browser-types";
import { WorkflowStore } from "./store.js";
import type { Boundary } from "./types.js";
type ManagedRun = <T>(caller: Caller, workerId: string, action: BackendMutationAction, operation: () => T | Promise<T>) => Promise<T>;
/** Stateless Workflow consumer; worker, turn and report facts remain in B. */
export declare class WorkflowWorkers {
    readonly backend: CodexBackend;
    readonly store: WorkflowStore;
    private readonly managedRun;
    readonly workflowSkillDir: string | undefined;
    readonly implementationStandardDir?: string | undefined;
    private readonly request;
    constructor(backend: CodexBackend, store: WorkflowStore, managedRun: ManagedRun, workflowSkillDir: string | undefined, implementationStandardDir?: string | undefined);
    run<T>(caller: Caller, assertIdentity: () => void, operation: () => T | Promise<T>): Promise<T>;
    assertIdentity(): void;
    list(parentId: string): Promise<readonly WorkerProjection[]>;
    get(parentId: string, id: string): Promise<WorkerProjection>;
    create(parentId: string, input: {
        id?: string;
        name: string;
        cwd: string;
        role?: string;
        model?: string;
        effort?: string;
        managed?: boolean;
        boundary?: Boundary;
    }): Promise<WorkerProjection>;
    append(parentId: string, id: string, text: string, managed?: boolean, idempotencyKey?: string): Promise<WorkerProjection>;
    steer(parentId: string, id: string, turnId: string, text: string, managed?: boolean): Promise<void>;
    interrupt(parentId: string, id: string, turnId: string, managed?: boolean): Promise<void>;
    accept(parentId: string, id: string, turnId: string, acceptance: ReportAcceptance, managed?: boolean): Promise<BackendReport>;
    acknowledge(parentId: string, id: string, turnId: string): Promise<BackendReport>;
    closeWorker(parentId: string, id: string, confirmedStopped?: boolean, managed?: boolean): Promise<void>;
    report(parentId: string, id: string, turnId?: string): Promise<BackendReport>;
    private context;
    private caller;
    private mutate;
    private managed;
    private expectedTurn;
}
export {};
//# sourceMappingURL=workers.d.ts.map