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

export type {
  CodexThreadHandoffRequest as ThreadHandoffRequest,
  CodexThreadHandoffResult as ThreadHandoffResult,
  CodexThreadOwnership as ThreadOwnership,
  CodexThreadHandoffService as ThreadHandoffService,
  CodexToolGate, GateBinding, GateDecision, GateEvent, GateHandler,
} from "dsh-codex-app-provider";

export interface WorkflowState {
  runs: unknown[];
  lanes: { path: string; owner?: string }[];
  selectedProfiles?: Record<string, string | null>;
  /** Session coding-strategy overrides; an absent entry inherits the stored default. */
  sessionStrategies?: Record<string, string | null>;
  nativeChildren?: Record<string, import("./workers.js").NativeChildRecord>;
}