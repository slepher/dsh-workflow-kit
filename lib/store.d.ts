import type { WorkflowState } from "./types.js";
export declare class WorkflowStore {
    readonly stateDir: string;
    private readonly file;
    private state;
    constructor(stateDir: string);
    read(): WorkflowState;
    save(): void;
}
//# sourceMappingURL=store.d.ts.map