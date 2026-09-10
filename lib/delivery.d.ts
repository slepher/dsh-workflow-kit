import type { Report } from "./types.js";
import type { Workers } from "./workers.js";
export interface ParentAgent {
    id?: string;
    session: {
        id: string;
    };
    status: string;
    followup(message: unknown): void;
}
export interface DeliveryHost {
    agents: {
        list(): ParentAgent[];
        get?(id: string): ParentAgent | undefined;
    };
    on(event: string, listener: (...args: any[]) => unknown): (() => void) | void;
    logger?: {
        warn(message: string): void;
    };
}
export declare function reportNotice(reports: readonly Report[]): unknown;
export declare function installDelivery(host: DeliveryHost, workers: Workers): () => void;
//# sourceMappingURL=delivery.d.ts.map