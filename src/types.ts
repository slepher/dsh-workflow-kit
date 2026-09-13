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

export interface WorkflowState {
  runs: unknown[];
  lanes: { path: string; owner?: string }[];
  selectedProfiles?: Record<string, string | null>;
  nativeChildren?: Record<string, import("./workers.js").NativeChildRecord>;
}
