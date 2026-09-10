import type { UsageValues, Worker, Conversation, Report } from './types.js';
export declare function reportUsage(report: Report | undefined, history: Conversation | null): UsageValues | undefined;
export declare function usageRows(usage: UsageValues): [string, string][];
export declare function TurnStats({ usage, durationMs, completedAt }: {
    usage?: UsageValues;
    durationMs?: number;
    completedAt?: number;
}): import("react").JSX.Element;
export declare function SessionStats({ worker, history }: {
    worker: Worker;
    history: Conversation | null;
}): import("react").JSX.Element;
//# sourceMappingURL=stats.d.ts.map