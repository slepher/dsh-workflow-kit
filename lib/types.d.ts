import type { BackendEvent, RunState } from "dsh-codex-kit-backend/browser-types";
export type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type Acceptance = "pending" | "accepted" | "changes-requested";
export interface Boundary {
    cwd: string;
    artifacts?: string;
    results?: string;
    writableRoots: string[];
    network: "disabled" | "loopback";
    ports: Record<string, number>;
}
export interface Role {
    name: string;
    description: string;
    model: string;
    effort: Effort;
    protocol: string;
    implementation: boolean;
}
export interface ResolvedRole extends Role {
    developerInstructions: string;
}
export interface Report {
    workerId: string;
    threadId?: string;
    turnId: string;
    status: Extract<RunState, "completed" | "failed" | "interrupted" | "unknown">;
    result: string;
    createdAt: string;
    acknowledgedAt?: string;
    acceptance: Acceptance;
}
export interface Worker {
    id: string;
    parentId: string;
    name: string;
    cwd: string;
    role?: string;
    model?: string;
    effort?: string;
    threadId?: string;
    turnId?: string;
    state: RunState;
    managed: boolean;
    closed?: boolean;
    lastEventSequence: number;
    reports: Report[];
    output: Record<string, unknown[]>;
}
export interface DurableBackendEvent {
    sequence: number;
    event: BackendEvent;
}
export type WorkerAction = {
    action: "roles" | "list" | "reports";
} | {
    action: "create";
    name: string;
    cwd?: string;
    role?: string;
    model?: string;
    effort?: Effort;
} | {
    action: "get";
    workerId: string;
} | {
    action: "append";
    workerId: string;
    text: string;
} | {
    action: "steer";
    workerId: string;
    turnId: string;
    text: string;
} | {
    action: "interrupt";
    workerId: string;
    turnId: string;
} | {
    action: "resume";
    workerId: string;
    confirmedStopped?: boolean;
} | {
    action: "ack";
    workerId: string;
    turnId: string;
} | {
    action: "accept";
    workerId: string;
    turnId: string;
    acceptance: Acceptance;
} | {
    action: "close";
    workerId: string;
    confirmedStopped?: boolean;
} | {
    action: "configure";
    workerId: string;
    model?: string;
    effort?: Effort;
} | {
    action: "approve";
    workerId: string;
    approvalId: string;
    decision: "accept" | "decline" | "cancel";
};
export interface WorkflowState {
    workers: Worker[];
    runs: unknown[];
    lanes: {
        path: string;
        owner?: string;
    }[];
}
//# sourceMappingURL=types.d.ts.map