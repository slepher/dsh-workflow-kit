import type { BackendEvent, RunState } from "dsh-codex-kit-backend/browser-types";
export type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type Acceptance = "pending" | "accepted" | "changes-requested";
export type State = RunState | "starting" | "saved";
export type Policy = "untrusted" | "on-failure" | "on-request" | "never";
export type Sandbox = "read-only" | "workspace-write" | "danger-full-access";
export interface UsageValues {
    totalTokens: number | null;
    inputTokens: number | null;
    cachedInputTokens: number | null;
    cacheWriteInputTokens: number | null;
    outputTokens: number | null;
    reasoningOutputTokens: number | null;
}
export interface Usage {
    total: UsageValues;
    last: UsageValues;
    modelContextWindow: number | null;
    currentContextTokens?: number | null;
    remainingContextRatio?: number | null;
}
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
    skills?: readonly string[];
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
    createdAt: string | number;
    acknowledgedAt?: string | number;
    acceptance: Acceptance;
    protocolError?: string;
    error?: string;
    usage?: Usage | null;
    turnUsage?: UsageValues;
}
export interface Compaction {
    id: string;
    turnId: string | null;
    status: "inProgress" | "completed" | "failed" | "interrupted" | "unknown";
    error?: string;
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
    state: State;
    managed: boolean;
    closed?: boolean;
    lastEventSequence: number;
    reports: Report[];
    output: Record<string, unknown[]>;
    owner?: "agent" | "user";
    savedState?: State;
    usage?: Usage | null;
    approvals?: {
        id: string;
        method: string;
        params: unknown;
    }[];
    compactions?: Compaction[];
    commands?: {
        id: string;
        status: string;
    }[];
    disabledMcp?: string[];
    executionConfig?: {
        approvalPolicy?: Policy;
        approvalsReviewer?: "user" | "auto_review" | "guardian_subagent";
        sandbox?: Sandbox;
    };
    detached?: boolean;
    rawUsageTotal?: UsageValues;
    usageOffset?: UsageValues;
    usageResetPending?: boolean;
    turnUsageStart?: UsageValues;
    requiredProfile?: {
        model: string;
        effort: Effort;
    };
    developerInstructions?: string;
    error?: string;
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
    /** @deprecated Legacy adapter only; the B4 Host never constructs or persists this writer. */
    workers?: Worker[];
    runs: unknown[];
    lanes: {
        path: string;
        owner?: string;
    }[];
}
export declare function parseUsage(value: any): Usage;
export interface Skill {
    name: string;
    path: string;
    description: string;
}
export type Action = {
    threadId?: string;
    cursor?: string;
    search?: string;
    skills?: Skill[];
    action: string;
    role?: string;
    workerId?: string;
    name?: string;
    cwd?: string;
    model?: string;
    effort?: string;
    text?: string;
    turnId?: string;
    acceptance?: string;
    confirmedStopped?: boolean;
    approvalId?: string;
    decision?: string;
};
export interface ConversationItem {
    id: string;
    turnId: string;
    role: "user" | "assistant" | "tool";
    text: string;
    kind?: string;
    phase?: string;
    status?: string;
    title?: string;
    output?: string;
    cwd?: string;
    exitCode?: number;
    durationMs?: number;
    arguments?: unknown;
    images?: string[];
    files?: {
        name: string;
        path: string;
    }[];
    changes?: {
        path: string;
        kind?: string;
        diff: string;
    }[];
}
export interface ConversationTurn {
    id: string;
    status?: string;
    startedAt?: number;
    completedAt?: number;
    durationMs?: number;
    error?: string;
}
export interface Conversation {
    turns?: ConversationTurn[];
    items: ConversationItem[];
    source: "thread" | "reports";
}
export interface ModelOption {
    model: string;
    displayName: string;
    supportedReasoningEfforts: {
        reasoningEffort: Effort;
        description: string;
    }[];
    defaultReasoningEffort: Effort;
}
export interface ModelSettings {
    models: ModelOption[];
    model: string | null;
    effort: Effort | null;
}
export declare function compactionTurnIds(history: Conversation | null): Set<string>;
//# sourceMappingURL=types.d.ts.map