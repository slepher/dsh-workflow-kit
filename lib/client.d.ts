import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type { Worker, Action } from './types.js';
export { WORKFLOW_PLUGIN_ID } from './constants.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        connection: ConnectionHandle;
    }
}
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
    interface SidebarRightTabParamsMap {
        'codex-worker': {
            workerId: string;
        };
    }
}
export declare const name = "dsh-workflow-kit";
export declare const inject: string[];
export type Call = (sessionId: string, input: Action) => Promise<unknown>;
export declare function workerLabel(w: Worker): string;
export declare function toggleWorker(sidebar: {
    isExpanded(): boolean;
    toggleExpanded(): void;
    openTab(kind: string, options: any): void;
}, current: {
    sessionId: string;
    workerId: string;
} | undefined, sessionId: string, w: Worker): void;
export declare function active(w: Worker): boolean;
export declare function occupancy(w: Worker): number | null;
export declare function formatContext(value: number | null | undefined): string;
export declare function Dock({ sessionId, call, open, newChat, resumeChat, collapsed, closed }: {
    sessionId: string;
    call: Call;
    open: (w: Worker) => void;
    newChat?: () => void;
    resumeChat?: () => void;
    collapsed?: boolean;
    closed?: (w: Worker) => void;
}): import("react").JSX.Element;
export declare function NewConversation({ sessionId, call, open }: {
    sessionId: string;
    call: Call;
    open: (w: Worker) => void;
}): import("react").JSX.Element;
export declare function ConversationPanel({ sessionId, workerId, call, fullscreen, newChat, closeChat }: {
    closeChat?: () => void;
    newChat?: () => void;
    sessionId: string;
    workerId: string;
    call: Call;
    fullscreen?: boolean;
}): import("react").JSX.Element;
export declare function apply(ctx: Context): void;
//# sourceMappingURL=client.d.ts.map