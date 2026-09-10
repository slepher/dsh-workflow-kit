import type { ReactNode } from 'react';
import type { Action, Conversation, Worker } from './types.js';
type Call = (sessionId: string, input: Action) => Promise<unknown>;
export declare function mergeEvent(history: Conversation, event: any): Conversation;
export declare function useConversation(sessionId: string, workerId: string, call: Call): {
    history: Conversation | null;
    error: string;
    retry: () => void;
};
export declare function Transcript({ sessionId, worker, history, error, busy, retry, act, footer, fullscreen }: {
    footer?: ReactNode;
    fullscreen?: boolean;
    sessionId: string;
    worker: Worker;
    history: Conversation | null;
    error: string;
    busy: boolean;
    retry: () => void;
    act: (action: Action) => Promise<boolean>;
}): import("react").JSX.Element;
export {};
//# sourceMappingURL=transcript.d.ts.map