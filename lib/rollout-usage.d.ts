import { type Usage } from './types.js';
/** Restore Codex's persisted snapshot; never estimate tokens from transcript text. */
export declare function rolloutUsage(path: string, threadId: string): Promise<Usage | null>;
//# sourceMappingURL=rollout-usage.d.ts.map