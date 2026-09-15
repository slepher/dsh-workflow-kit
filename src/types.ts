import type { AgentOptions } from "@deepseek-ai/dsh-agent";

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
 * The native execution inputs one managed child's creation options carry.
 *
 * Declared structurally on purpose: the installed `@deepseek-ai/dsh-agent`
 * declares no `execution` field on `AgentOptions`, and this plugin is that
 * field's producer (the Codex provider is its only consumer). Child resolution
 * keeps the requested object verbatim, so the value reaches the provider even
 * though the core type does not name it.
 */
export interface ChildExecutionInputs {
  developerInstructions?: string;
  boundary?: { cwd: string; writableRoots: readonly string[]; network: "disabled" | "loopback" };
}

/** Child creation options plus the execution field the core preserves by spread. */
export type ChildAgentOptions = AgentOptions & { execution?: ChildExecutionInputs };

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

/**
 * The provider's workflow gate surface, as published on `ctx.codexToolGate`.
 *
 * Declared structurally for the same reason as the thread handover above: this
 * plugin has to load and build against a provider package that predates the
 * capability, and then refuse a Codex child it cannot gate rather than run it
 * unchecked. The shapes are the provider's `GateBinding`/`GateEvent`/`GateDecision`.
 */
export interface GateBinding {
  /** Host business label; the provider never enumerates or interprets it. */
  role: string;
  /** The registered handler this Session's operations are checked by. */
  hook: string;
  /** Host-owned JSON arguments describing the Session's authorization. */
  args: Record<string, unknown>;
}

/** One operation about to execute, from either entry point. */
export interface GateEvent {
  source: "dsh" | "codex";
  /** DSH Session identity, resolved by the Host; never taken from a payload. */
  sessionId: string;
  callId: string;
  /** Trusted Session/operation working directory. */
  cwd: string;
  toolName: string;
  /** The complete original tool arguments, preserved for the handler. */
  toolArgs: unknown;
}

export type GateDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string };

export type GateHandler = (
  binding: Readonly<GateBinding>,
  event: Readonly<GateEvent>,
) => GateDecision;

/** The Host-facing gate capability the Codex provider publishes. */
export interface CodexToolGate {
  register(hook: string, handler: GateHandler): () => void;
  bind(sessionId: string, binding: GateBinding): void;
}

export interface WorkflowState {
  runs: unknown[];
  lanes: { path: string; owner?: string }[];
  selectedProfiles?: Record<string, string | null>;
  /** Session coding-strategy overrides; an absent entry inherits the stored default. */
  sessionStrategies?: Record<string, string | null>;
  nativeChildren?: Record<string, import("./workers.js").NativeChildRecord>;
}