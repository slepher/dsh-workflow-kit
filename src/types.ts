export type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

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
  provider: string;
  model: string;
  effort: Effort;
  protocol: string;
  implementation: boolean;
  skills?: readonly string[];
}

export interface ResolvedRole extends Role { developerInstructions: string }

/**
 * Trusted-Host thread handover, as the Codex provider publishes it on
 * `ctx.codexHandoff`.
 *
 * Declared structurally on purpose: this plugin must load and build against a
 * provider package that predates the capability, and then report the missing
 * route instead of silently running the old configuration.
 */
export interface ThreadHandoffRequest {
  /** Host request identity; a repeated request reuses its recorded handover. */
  requestId: string;
  /** DSH Session whose native thread is handed over. */
  fromSessionId: string;
  /** Reserved successor DSH Session that continues it. */
  toSessionId: string;
  /** Target model and effort the successor runs on. */
  model: string;
  reasoningEffort?: string;
  /** Full execution inputs the successor's first request will carry. */
  developerInstructions?: string;
  boundary?: { cwd: string; writableRoots: readonly string[]; network: "disabled" | "loopback" };
}

/** The recorded outcome of one native thread handover. */
export interface ThreadHandoffResult {
  toSessionId: string;
  threadId: string;
  state: string;
}

/** Read-only native thread ownership for Host reconciliation. */
export interface ThreadOwnership {
  sessionId: string;
  threadId?: string;
  handedOffTo?: string;
  handoffFrom?: string;
}

export interface ThreadHandoffService {
  handoff(request: ThreadHandoffRequest): Promise<ThreadHandoffResult>;
  read?(nativeSessionId: string): Promise<ThreadOwnership | undefined>;
}

export interface WorkflowState {
  runs: unknown[];
  lanes: { path: string; owner?: string }[];
  selectedProfiles?: Record<string, string | null>;
  /** Session coding-strategy overrides; an absent entry inherits the stored default. */
  sessionStrategies?: Record<string, string | null>;
  nativeChildren?: Record<string, import("./workers.js").NativeChildRecord>;
}
