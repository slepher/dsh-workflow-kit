import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-subagent";
import { queueHostSubagentPrompt, steerHostSubagentPrompt } from "@deepseek-ai/dsh-subagent/internal";
import type { NativeExecutionReport } from "dsh-codex-app-provider";
import type {} from "dsh-codex-app-provider";
import type { WorkflowStore } from "./store.js";
import type { WorkflowConfiguration, RoleExecution } from "./configuration.js";
import type { Boundary } from "./types.js";

export type ReportAcceptance = "pending" | "accepted" | "changes-requested";
export type Report = NativeExecutionReport & { workerId: string; acceptance: ReportAcceptance; acknowledgedAt?: number };
export interface NativeChildRecord {
  id: string;
  parentSessionId: string;
  name: string;
  role: string;
  profile: string;
  execution: RoleExecution;
  boundary: Boundary;
  closed?: boolean;
  dispatches: { key: string; text: string; phase: "pending" | "accepted"; previousTurnId?: string; messageId?: string }[];
  acceptance: Record<string, { value: ReportAcceptance; acknowledgedAt?: number }>;
}
export interface WorkerProjection {
  id: string;
  parentSessionId: string;
  name: string;
  role: string;
  profile: string;
  cwd: string;
  model: string;
  effort: string;
  threadId?: string;
  turnId?: string;
  state: "idle" | "running" | "waiting-approval" | "interrupt-requested" | "unknown";
  reports: readonly Report[];
}

/** Workflow owns authorization and acceptance; native children and Codex own execution facts. */
export class WorkflowWorkers {
  private readonly request = new AsyncLocalStorage<{ parent: Agent; session: Agent["session"]; signal: AbortSignal }>();

  constructor(readonly ctx: Context, readonly store: WorkflowStore, readonly configuration: WorkflowConfiguration,
    readonly defaultProfile?: string, readonly workflowSkillDir?: string, readonly implementationStandardDir?: string) {}

  run<T>(parent: Agent, signal: AbortSignal, operation: () => T | Promise<T>): Promise<T> {
    return Promise.resolve(this.request.run({ parent, session: parent.session, signal }, () => { this.assertIdentity(); return operation(); }));
  }

  assertIdentity(): void {
    const value = this.context();
    if (this.ctx.agents.get(value.parent.id) !== value.parent || this.ctx.sessions.get(value.session.id) !== value.session
      || value.parent.session !== value.session) throw new Error("Parent agent identity changed");
  }

  captureRole(role: string, requiredRoles: readonly string[] = []) {
    this.assertIdentity();
    const profile = this.store.selectedProfile(String(this.context().session.id), this.defaultProfile);
    return { role, profile: profile!, execution: this.configuration.capture(profile, role, requiredRoles) };
  }

  selectedRoles() {
    this.assertIdentity();
    const selected = this.store.selectedProfile(String(this.context().session.id), this.defaultProfile);
    if (selected === undefined) throw new Error("No workflow profile selected");
    const profile = this.configuration.view().profiles.find(profile => profile.id === selected);
    if (profile === undefined) throw new Error(`Selected workflow profile is unavailable: ${selected}`);
    return profile.roles;
  }

  async create(parentId: string, input: { id?: string; name: string; cwd: string; role: string; profile: string; execution: RoleExecution; managed?: boolean; boundary: Boundary }): Promise<WorkerProjection> {
    this.parent(parentId); this.managed(input.managed);
    if (!input.id || input.boundary.cwd !== input.cwd) throw new Error("Managed child requires a stable identity and matching workspace");
    const previous = this.store.read().nativeChildren?.[input.id];
    if (previous !== undefined) {
      if (previous.parentSessionId !== parentId) throw new Error("Managed child parent identity mismatch");
      // A repeated creation uses the original snapshot, even after a profile switch.
      return this.get(parentId, input.id);
    }
    this.store.putNativeChild({ id: input.id, parentSessionId: parentId, name: input.name, role: input.role, profile: input.profile,
      execution: structuredClone(input.execution), boundary: structuredClone(input.boundary), dispatches: [], acceptance: {} });
    return this.get(parentId, input.id);
  }

  async list(parentId: string): Promise<readonly WorkerProjection[]> {
    this.parent(parentId);
    return Promise.all(Object.values(this.store.read().nativeChildren ?? {}).filter(record => record.parentSessionId === parentId && !record.closed).map(record => this.get(parentId, record.id)));
  }

  async get(parentId: string, id: string): Promise<WorkerProjection> {
    const record = this.record(parentId, id);
    const facts = await this.ctx.codexExecution.read(id);
    this.assertIdentity();
    const active = this.ctx.agents.get(SessionId(id));
    if (active !== undefined && String(active.session.header.parentSession) !== parentId) throw new Error("Native child parent identity mismatch");
    let state: WorkerProjection["state"];
    if (facts === undefined) state = record.dispatches.length === 0 ? "idle" : active === undefined ? "unknown" : "running";
    else if (facts.cwd !== record.boundary.cwd || facts.model !== record.execution.model || facts.reasoningEffort !== record.execution.reasoningEffort) state = "unknown";
    else if (facts.state === "unknown" || facts.state === "saved") state = "unknown";
    else if (facts.state === "waiting-approval" || facts.state === "interrupt-requested") state = facts.state;
    else if (facts.state === "running" || facts.state === "starting" || active?.status === "running") state = "running";
    else state = facts.state === "idle" ? "idle" : "unknown";
    const dispatch = record.dispatches.at(-1);
    const awaitingTurn = dispatch !== undefined && (facts?.turnId === undefined || facts.turnId === dispatch.previousTurnId);
    if (awaitingTurn && state === "idle") state = active === undefined ? "unknown" : "running";
    const reports = (facts?.reports ?? []).map(report => ({ ...report, workerId: id,
      acceptance: record.acceptance[report.turnId]?.value ?? "pending", acknowledgedAt: record.acceptance[report.turnId]?.acknowledgedAt }));
    return { id, parentSessionId: parentId, name: record.name, role: record.role, profile: record.profile, cwd: record.boundary.cwd,
      model: facts?.model ?? record.execution.model, effort: facts?.reasoningEffort ?? record.execution.reasoningEffort,
      threadId: facts?.threadId, turnId: awaitingTurn ? undefined : facts?.turnId, state, reports };
  }

  async append(parentId: string, id: string, text: string, managed = false, idempotencyKey?: string): Promise<WorkerProjection> {
    const parent = this.parent(parentId); this.managed(managed);
    if (!text.trim()) throw new Error("Task text must not be empty");
    const record = structuredClone(this.record(parentId, id));
    if (record.closed) throw new Error("Workflow child is closed");
    const key = idempotencyKey ?? `${id}:${record.dispatches.length + 1}`;
    const prior = record.dispatches.find(dispatch => dispatch.key === key);
    if (prior !== undefined) {
      if (prior.text !== text) throw new Error("Idempotency key input mismatch");
      const current = await this.get(parentId, id);
      if (prior.phase === "pending" && current.turnId === undefined) throw new Error("Native inbox acceptance is unknown; do not redispatch");
      return current;
    }
    const current = await this.get(parentId, id);
    if (current.state !== "idle") throw new Error(`Worker is ${current.state}; no new task was sent`);
    const initial = record.dispatches.length === 0;
    record.dispatches.push({ key, text, phase: "pending", previousTurnId: current.turnId });
    this.assertIdentity(); this.store.putNativeChild(record);
    const { signal } = this.context();
    let messageId: string;
    if (initial) {
      const created = await this.ctx.subagents.startContinuable({ provider: "spawn", label: record.name, childId: SessionId(id), signal,
        request: { parent, prompt: [{ type: "text", text }], agentOptions: {
          provider: "codex", model: record.execution.model, reasoningEffort: ReasoningEffortId(record.execution.reasoningEffort),
          execution: { developerInstructions: record.execution.developerInstructions,
            boundary: { cwd: record.boundary.cwd, writableRoots: record.boundary.writableRoots, network: record.boundary.network } },
        } } });
      messageId = created.messageId;
    } else {
      messageId = await queueHostSubagentPrompt(this.ctx.subagents, parent, SessionId(id), [{ type: "text", text }], { kind: "user" }, signal);
    }
    this.assertIdentity();
    record.dispatches[record.dispatches.length - 1] = { key, text, phase: "accepted", previousTurnId: current.turnId, messageId };
    this.store.putNativeChild(record);
    return this.get(parentId, id);
  }

  async steer(parentId: string, id: string, turnId: string, text: string, managed = false): Promise<void> {
    this.managed(managed);
    const worker = await this.get(parentId, id); this.expectedTurn(worker, turnId);
    if (worker.state !== "running") throw new Error(`Cannot steer worker ${worker.state}`);
    await steerHostSubagentPrompt(this.ctx.subagents, this.parent(parentId), SessionId(id), [{ type: "text", text }], { kind: "user" }, this.context().signal);
    this.assertIdentity();
  }

  async interrupt(parentId: string, id: string, turnId: string, managed = false): Promise<void> {
    this.managed(managed); this.expectedTurn(await this.get(parentId, id), turnId);
    this.ctx.subagents.interrupt(SessionId(id), { kind: "ancestor", agent: this.parent(parentId) });
    this.assertIdentity();
  }

  async accept(parentId: string, id: string, turnId: string, acceptance: ReportAcceptance, managed = false): Promise<Report> {
    this.managed(managed);
    const worker = await this.get(parentId, id);
    if (worker.state !== "idle") throw new Error("Execution is not confirmed idle");
    const report = worker.reports.find(report => report.turnId === turnId);
    if (report === undefined || report.status !== "completed") throw new Error("A completed report is required");
    if (!["pending", "accepted", "changes-requested"].includes(acceptance)) throw new Error("Unknown report acceptance");
    if (acceptance === "accepted" && (report.protocolError !== undefined || !report.result.trim())) throw new Error("Cannot accept a report without a deliverable result");
    const record = structuredClone(this.record(parentId, id));
    const acknowledgedAt = report.acknowledgedAt ?? (acceptance === "pending" ? undefined : Date.now());
    record.acceptance[turnId] = { value: acceptance, acknowledgedAt };
    this.store.putNativeChild(record);
    return { ...report, acceptance, acknowledgedAt };
  }

  async acknowledge(parentId: string, id: string, turnId: string): Promise<Report> {
    const report = await this.report(parentId, id, turnId);
    const record = structuredClone(this.record(parentId, id));
    const acknowledgedAt = report.acknowledgedAt ?? Date.now();
    record.acceptance[turnId] = { value: report.acceptance, acknowledgedAt };
    this.store.putNativeChild(record);
    return { ...report, acknowledgedAt };
  }

  async closeWorker(parentId: string, id: string, _confirmedStopped = false, managed = false): Promise<void> {
    this.managed(managed);
    const worker = await this.get(parentId, id);
    if (worker.state !== "idle" || worker.reports.some(report => report.acknowledgedAt === undefined)) throw new Error("Confirm native terminal execution and acknowledge reports before closing");
    this.store.putNativeChild({ ...this.record(parentId, id), closed: true });
  }

  async report(parentId: string, id: string, turnId?: string): Promise<Report> {
    const reports = (await this.get(parentId, id)).reports;
    const report = turnId === undefined ? reports.at(-1) : reports.find(report => report.turnId === turnId);
    if (report === undefined) throw new Error("Report not found");
    return report;
  }

  private context() { const value = this.request.getStore(); if (value === undefined) throw new Error("Managed workflow request context is unavailable"); return value; }
  private parent(parentId: string): Agent { this.assertIdentity(); const { parent, session } = this.context(); if (String(session.id) !== parentId) throw new Error("Managed workflow parent identity mismatch"); return parent; }
  private record(parentId: string, id: string): NativeChildRecord { this.parent(parentId); const record = this.store.read().nativeChildren?.[id]; if (record === undefined || record.parentSessionId !== parentId) throw new Error("Managed workflow child not found"); return record; }
  private managed(value: boolean | undefined): void { if (value !== true) throw new Error("Managed workflow child requires codex_workflow"); }
  private expectedTurn(worker: WorkerProjection, turnId: string): void { if (!turnId || worker.turnId !== turnId) throw new Error("Turn identity mismatch"); }
}
