import { AsyncLocalStorage } from "node:async_hooks";
import type { BackendMutationAction, Caller, CodexBackend, Report as BackendReport, ReportAcceptance, WorkerProjection } from "dsh-codex-kit-backend/browser-types";
import { WorkflowStore } from "./store.js";
import type { Boundary } from "./types.js";

type ManagedRun = <T>(caller: Caller, workerId: string, action: BackendMutationAction, operation: () => T | Promise<T>) => Promise<T>;

/** Stateless Workflow consumer; worker, turn and report facts remain in B. */
export class WorkflowWorkers {
  private readonly request = new AsyncLocalStorage<{ caller: Caller; assertIdentity: () => void }>();

  constructor(
    readonly backend: CodexBackend,
    readonly store: WorkflowStore,
    private readonly managedRun: ManagedRun,
    readonly workflowSkillDir: string | undefined,
    readonly implementationStandardDir?: string,
  ) {}

  run<T>(caller: Caller, assertIdentity: () => void, operation: () => T | Promise<T>): Promise<T> {
    return Promise.resolve(this.request.run({ caller: structuredClone(caller), assertIdentity }, operation));
  }

  assertIdentity(): void { this.context().assertIdentity(); }

  async list(parentId: string): Promise<readonly WorkerProjection[]> {
    const caller = this.caller(parentId), workers = await this.backend.listWorkers(caller);
    this.assertIdentity();
    return workers.filter(worker => worker.managedBy === "workflow");
  }

  async get(parentId: string, id: string): Promise<WorkerProjection> {
    const caller = this.caller(parentId), worker = await this.backend.getWorker(caller, id);
    this.assertIdentity();
    if (worker.managedBy !== "workflow") throw new Error("Managed workflow worker not found");
    return worker;
  }

  async create(parentId: string, input: { id?: string; name: string; cwd: string; role?: string; model?: string; effort?: string; managed?: boolean; boundary?: Boundary }): Promise<WorkerProjection> {
    if (!input.id || input.managed !== true) throw new Error("Managed workflow create requires a stable identity");
    const caller = this.caller(parentId);
    return this.mutate(caller, input.id, "create", () => this.backend.createWorker(caller, {
      id: input.id, name: input.name, cwd: input.cwd, ...(input.role === undefined ? {} : { role: input.role }), boundary: input.boundary,
    }));
  }

  async append(parentId: string, id: string, text: string, managed = false, idempotencyKey?: string): Promise<WorkerProjection> {
    this.managed(managed);
    const worker = await this.get(parentId, id);
    if (!text.trim() || worker.state !== "idle") throw new Error(`Worker is ${worker.state}; use steer for an active turn`);
    const caller = this.caller(parentId);
    await this.mutate(caller, id, "start", () => this.backend.startTurn(caller, id, text, { idempotencyKey: idempotencyKey ?? `${id}:${worker.reports.length + 1}` }));
    return this.get(parentId, id);
  }

  async steer(parentId: string, id: string, turnId: string, text: string, managed = false): Promise<void> {
    this.managed(managed); this.expectedTurn(await this.get(parentId, id), turnId);
    const caller = this.caller(parentId);
    await this.mutate(caller, id, "steer", () => this.backend.steerTurn(caller, id, turnId, text));
  }

  async interrupt(parentId: string, id: string, turnId: string, managed = false): Promise<void> {
    this.managed(managed); this.expectedTurn(await this.get(parentId, id), turnId);
    const caller = this.caller(parentId);
    await this.mutate(caller, id, "interrupt", () => this.backend.interruptTurn(caller, id, turnId));
  }

  async accept(parentId: string, id: string, turnId: string, acceptance: ReportAcceptance, managed = false): Promise<BackendReport> {
    this.managed(managed); const caller = this.caller(parentId);
    return this.mutate(caller, id, "accept-report", () => this.backend.acceptReport(caller, id, turnId, acceptance));
  }

  async acknowledge(parentId: string, id: string, turnId: string): Promise<BackendReport> {
    const caller = this.caller(parentId);
    return this.mutate(caller, id, "ack-report", () => this.backend.acknowledgeReport(caller, id, turnId));
  }

  async closeWorker(parentId: string, id: string, confirmedStopped = false, managed = false): Promise<void> {
    this.managed(managed); const caller = this.caller(parentId);
    await this.mutate(caller, id, "close", () => this.backend.closeSession(caller, id, confirmedStopped));
  }

  async report(parentId: string, id: string, turnId?: string): Promise<BackendReport> {
    const reports = (await this.get(parentId, id)).reports;
    const report = turnId ? reports.find(item => item.turnId === turnId) : reports.at(-1);
    if (!report) throw new Error("Report not found");
    return report;
  }

  private context() {
    const request = this.request.getStore();
    if (!request) throw new Error("Managed workflow request context is unavailable");
    return request;
  }
  private caller(parentId: string): Caller {
    const request = this.context(); request.assertIdentity();
    if (request.caller.source !== "agent" || !request.caller.parentAgent || request.caller.nativeSessionId !== parentId) throw new Error("Managed workflow parent identity mismatch");
    return request.caller;
  }
  private mutate<T>(caller: Caller, workerId: string, action: BackendMutationAction, operation: () => T | Promise<T>): Promise<T> {
    this.assertIdentity();
    return this.managedRun(caller, workerId, action, async () => {
      this.assertIdentity(); const result = await operation(); this.assertIdentity(); return result;
    });
  }
  private managed(value: boolean): void { if (!value) throw new Error("Managed workflow worker requires codex_workflow"); }
  private expectedTurn(worker: WorkerProjection, turnId: string): void { if (!turnId || worker.turnId !== turnId) throw new Error("Turn identity mismatch"); }
}
