import { AsyncLocalStorage } from "node:async_hooks";
/** Stateless Workflow consumer; worker, turn and report facts remain in B. */
export class WorkflowWorkers {
    backend;
    store;
    managedRun;
    workflowSkillDir;
    implementationStandardDir;
    request = new AsyncLocalStorage();
    constructor(backend, store, managedRun, workflowSkillDir, implementationStandardDir) {
        this.backend = backend;
        this.store = store;
        this.managedRun = managedRun;
        this.workflowSkillDir = workflowSkillDir;
        this.implementationStandardDir = implementationStandardDir;
    }
    run(caller, assertIdentity, operation) {
        return Promise.resolve(this.request.run({ caller: structuredClone(caller), assertIdentity }, operation));
    }
    assertIdentity() { this.context().assertIdentity(); }
    async list(parentId) {
        const caller = this.caller(parentId), workers = await this.backend.listWorkers(caller);
        this.assertIdentity();
        return workers.filter(worker => worker.managedBy === "workflow");
    }
    async get(parentId, id) {
        const caller = this.caller(parentId), worker = await this.backend.getWorker(caller, id);
        this.assertIdentity();
        if (worker.managedBy !== "workflow")
            throw new Error("Managed workflow worker not found");
        return worker;
    }
    async create(parentId, input) {
        if (!input.id || input.managed !== true)
            throw new Error("Managed workflow create requires a stable identity");
        const caller = this.caller(parentId);
        return this.mutate(caller, input.id, "create", () => this.backend.createWorker(caller, {
            id: input.id, name: input.name, cwd: input.cwd, ...(input.role === undefined ? {} : { role: input.role }), boundary: input.boundary,
        }));
    }
    async append(parentId, id, text, managed = false, idempotencyKey) {
        this.managed(managed);
        const worker = await this.get(parentId, id);
        if (!text.trim() || worker.state !== "idle")
            throw new Error(`Worker is ${worker.state}; use steer for an active turn`);
        const caller = this.caller(parentId);
        await this.mutate(caller, id, "start", () => this.backend.startTurn(caller, id, text, { idempotencyKey: idempotencyKey ?? `${id}:${worker.reports.length + 1}` }));
        return this.get(parentId, id);
    }
    async steer(parentId, id, turnId, text, managed = false) {
        this.managed(managed);
        this.expectedTurn(await this.get(parentId, id), turnId);
        const caller = this.caller(parentId);
        await this.mutate(caller, id, "steer", () => this.backend.steerTurn(caller, id, turnId, text));
    }
    async interrupt(parentId, id, turnId, managed = false) {
        this.managed(managed);
        this.expectedTurn(await this.get(parentId, id), turnId);
        const caller = this.caller(parentId);
        await this.mutate(caller, id, "interrupt", () => this.backend.interruptTurn(caller, id, turnId));
    }
    async accept(parentId, id, turnId, acceptance, managed = false) {
        this.managed(managed);
        const caller = this.caller(parentId);
        return this.mutate(caller, id, "accept-report", () => this.backend.acceptReport(caller, id, turnId, acceptance));
    }
    async acknowledge(parentId, id, turnId) {
        const caller = this.caller(parentId);
        return this.mutate(caller, id, "ack-report", () => this.backend.acknowledgeReport(caller, id, turnId));
    }
    async closeWorker(parentId, id, confirmedStopped = false, managed = false) {
        this.managed(managed);
        const caller = this.caller(parentId);
        await this.mutate(caller, id, "close", () => this.backend.closeSession(caller, id, confirmedStopped));
    }
    async report(parentId, id, turnId) {
        const reports = (await this.get(parentId, id)).reports;
        const report = turnId ? reports.find(item => item.turnId === turnId) : reports.at(-1);
        if (!report)
            throw new Error("Report not found");
        return report;
    }
    context() {
        const request = this.request.getStore();
        if (!request)
            throw new Error("Managed workflow request context is unavailable");
        return request;
    }
    caller(parentId) {
        const request = this.context();
        request.assertIdentity();
        if (request.caller.source !== "agent" || !request.caller.parentAgent || request.caller.nativeSessionId !== parentId)
            throw new Error("Managed workflow parent identity mismatch");
        return request.caller;
    }
    mutate(caller, workerId, action, operation) {
        this.assertIdentity();
        return this.managedRun(caller, workerId, action, async () => {
            this.assertIdentity();
            const result = await operation();
            this.assertIdentity();
            return result;
        });
    }
    managed(value) { if (!value)
        throw new Error("Managed workflow worker requires codex_workflow"); }
    expectedTurn(worker, turnId) { if (!turnId || worker.turnId !== turnId)
        throw new Error("Turn identity mismatch"); }
}
//# sourceMappingURL=workers.js.map