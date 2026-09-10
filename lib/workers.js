import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { resolveRole } from "./roles.js";
const terminal = new Set(["completed", "failed", "interrupted", "unknown"]);
const owner = (parentId) => `workflow:${parentId}`;
export class Workers extends EventEmitter {
    backend;
    store;
    workflowSkillDir;
    implementationStandardDir;
    permitted = new AsyncLocalStorage();
    subscriptions = new Map();
    guards = new Map();
    constructor(backend, store, workflowSkillDir, implementationStandardDir) {
        super();
        this.backend = backend;
        this.store = store;
        this.workflowSkillDir = workflowSkillDir;
        this.implementationStandardDir = implementationStandardDir;
        this.guards.set("global", this.backend.installGuard(request => this.guard(request)));
        for (const worker of store.read().workers.filter(item => !item.closed))
            this.watch(worker);
    }
    list(parentId) { return this.store.read().workers.filter(worker => worker.parentId === parentId && !worker.closed); }
    get(parentId, id) {
        const worker = this.list(parentId).find(item => item.id === id);
        if (!worker)
            throw new Error("Worker not found");
        return worker;
    }
    pending(parentId) { return this.list(parentId).flatMap(worker => worker.reports.filter(report => !report.acknowledgedAt)); }
    async create(parentId, input) {
        if (!parentId || !input.name.trim())
            throw new Error("Parent and worker name are required");
        if (!input.managed)
            this.assertLaneAvailable(input.cwd);
        const role = input.role ? resolveRole(input.role, this.workflowSkillDir, this.implementationStandardDir) : undefined;
        const id = input.id ?? randomUUID();
        if (this.store.read().workers.some(worker => worker.id === id))
            throw new Error("Worker identity already exists");
        const worker = {
            id, parentId, name: input.name, cwd: input.cwd, role: role?.name,
            model: role?.model ?? input.model, effort: role?.effort ?? input.effort,
            state: "unknown", managed: input.managed === true,
            lastEventSequence: 0, reports: [], output: {},
        };
        this.store.read().workers.push(worker);
        this.store.save();
        const options = { model: worker.model, reasoningEffort: worker.effort, developerInstructions: role?.developerInstructions, boundary: input.boundary };
        try {
            const session = await this.allow(() => this.backend.createSession(owner(parentId), id, input.cwd, options));
            worker.model = session.model ?? worker.model;
            worker.effort = session.reasoningEffort ?? worker.effort;
            worker.threadId = session.threadId;
            worker.state = session.state;
            this.store.save();
            this.watch(worker);
            this.emit("changed", worker);
        }
        catch (error) {
            this.emit("changed", worker);
            throw error;
        }
        return structuredClone(worker);
    }
    async append(parentId, id, text, managed = false) {
        const worker = this.get(parentId, id);
        if (worker.managed !== managed)
            throw new Error("Managed workflow worker requires codex_workflow");
        if (!text.trim() || worker.state !== "idle")
            throw new Error(`Worker is ${worker.state}; use steer for an active turn`);
        const key = `${worker.id}:${worker.reports.length + 1}`;
        const options = { model: worker.model, reasoningEffort: worker.effort, idempotencyKey: key };
        worker.state = "running";
        this.store.save();
        try {
            const turn = await this.allow(() => this.backend.startTurn(owner(parentId), id, text, options));
            worker.threadId = turn.threadId;
            worker.turnId = turn.turnId;
            worker.state = turn.state;
            worker.output[turn.turnId] ??= [];
            this.store.save();
            this.emit("changed", worker);
            return structuredClone(worker);
        }
        catch (error) {
            const session = await this.backend.readSession(owner(parentId), id).catch(() => undefined);
            worker.state = session?.state ?? "unknown";
            this.store.save();
            this.emit("changed", worker);
            throw error;
        }
    }
    async steer(parentId, id, turnId, text, managed = false) {
        const worker = this.get(parentId, id);
        this.managed(worker, managed);
        this.expectedTurn(worker, turnId);
        await this.allow(() => this.backend.steerTurn(owner(parentId), turnId, text));
    }
    async interrupt(parentId, id, turnId, managed = false) {
        const worker = this.get(parentId, id);
        this.managed(worker, managed);
        this.expectedTurn(worker, turnId);
        await this.allow(() => this.backend.interruptTurn(owner(parentId), turnId));
        worker.state = "interrupt-requested";
        this.store.save();
        this.emit("changed", worker);
    }
    async resume(parentId, id, confirmedStopped = false, managed = false) {
        const worker = this.get(parentId, id);
        this.managed(worker, managed);
        const session = await this.allow(() => this.backend.resumeSession(owner(parentId), id, confirmedStopped));
        worker.threadId = session.threadId;
        worker.state = session.state;
        this.store.save();
        this.watch(worker);
        await this.reconcile(worker);
        return structuredClone(worker);
    }
    async configure(parentId, id, model, effort, managed = false) {
        const worker = this.get(parentId, id);
        this.managed(worker, managed);
        const session = await this.allow(() => this.backend.configureSession(owner(parentId), id, { model, reasoningEffort: effort }));
        worker.model = session.model;
        worker.effort = session.reasoningEffort;
        this.store.save();
        return structuredClone(worker);
    }
    async approve(parentId, id, approvalId, decision) {
        this.get(parentId, id);
        await this.allow(() => this.backend.decideApproval(owner(parentId), approvalId, decision));
    }
    acknowledge(parentId, id, turnId) {
        const report = this.report(parentId, id, turnId);
        report.acknowledgedAt ??= new Date().toISOString();
        this.store.save();
        return structuredClone(report);
    }
    accept(parentId, id, turnId, acceptance, managed = false) {
        const worker = this.get(parentId, id);
        this.managed(worker, managed);
        if (!(acceptance === "accepted" || acceptance === "changes-requested"))
            throw new Error("Invalid acceptance");
        const report = this.report(parentId, id, turnId);
        report.acceptance = acceptance;
        report.acknowledgedAt ??= new Date().toISOString();
        this.store.save();
        return structuredClone(report);
    }
    async closeWorker(parentId, id, confirmedStopped = false, managed = false) {
        const worker = this.get(parentId, id);
        this.managed(worker, managed);
        if (worker.state === "unknown" && confirmedStopped)
            await this.resume(parentId, id, true, managed);
        if (worker.state !== "idle")
            throw new Error("Only an idle worker can close");
        if (worker.reports.some(report => !report.acknowledgedAt))
            throw new Error("Acknowledge or accept every report before close");
        await this.allow(() => this.backend.closeSession(owner(parentId), id));
        worker.closed = true;
        this.subscriptions.get(id)?.();
        this.subscriptions.delete(id);
        this.store.save();
        this.emit("changed", worker);
    }
    async reconcile(worker) {
        for (const record of await this.backend.readEvents(owner(worker.parentId), worker.id, worker.lastEventSequence)) {
            this.consume(worker, record.event);
            worker.lastEventSequence = Math.max(worker.lastEventSequence, record.sequence);
            this.store.save();
        }
    }
    async reconcileAll() { for (const worker of this.store.read().workers.filter(item => !item.closed))
        await this.reconcile(worker); }
    async close() { for (const off of this.subscriptions.values())
        off(); this.subscriptions.clear(); for (const off of this.guards.values())
        off(); this.guards.clear(); }
    report(parentId, id, turnId) {
        const report = this.get(parentId, id).reports.find(item => item.turnId === turnId);
        if (!report)
            throw new Error("Report not found");
        return report;
    }
    managed(worker, allowed) { if (worker.managed !== allowed)
        throw new Error("Managed workflow worker requires codex_workflow"); }
    expectedTurn(worker, turnId) { if (!turnId || worker.turnId !== turnId)
        throw new Error("Turn identity mismatch"); }
    watch(worker) {
        if (this.subscriptions.has(worker.id))
            return;
        this.subscriptions.set(worker.id, this.backend.subscribe(owner(worker.parentId), worker.id, event => this.consume(worker, event)));
    }
    consume(worker, event) {
        if (event.type === "turn.started") {
            worker.threadId = event.turn.threadId;
            worker.turnId = event.turn.turnId;
            worker.state = event.turn.state;
            worker.output[event.turn.turnId] ??= [];
        }
        else if (event.type === "turn.output")
            (worker.output[event.turnId] ??= []).push(event.item);
        else if (event.type === "turn.state") {
            worker.threadId = event.turn.threadId;
            worker.turnId = event.turn.turnId;
            worker.state = event.turn.state === "unknown" ? "unknown" : "idle";
            if (terminal.has(event.turn.state))
                this.complete(worker, event.turn.turnId, event.turn.state, event.finalOutput);
        }
        else if (event.type === "approval.requested")
            worker.state = "waiting-approval";
        this.store.save();
        this.emit("changed", worker);
    }
    complete(worker, turnId, status, finalOutput) {
        if (worker.reports.some(report => report.turnId === turnId)) {
            delete worker.output[turnId];
            return;
        }
        const result = finalOutput ?? finalText(worker.output[turnId] ?? []);
        const report = { workerId: worker.id, threadId: worker.threadId, turnId, status, result: result || (status === "completed" ? "Result missing from terminal output." : `Execution ${status}.`), createdAt: new Date().toISOString(), acceptance: "pending" };
        worker.reports.push(report);
        delete worker.output[turnId];
        this.store.save();
        this.emit("report", report, worker.parentId);
    }
    guard(request) {
        if (this.permitted.getStore())
            return;
        const managed = request.sessionId && this.store.read().workers.some(worker => worker.id === request.sessionId && worker.managed && !worker.closed);
        if (managed)
            throw new Error(`Managed workflow worker: ${request.action} requires codex_workflow`);
        for (const path of [request.cwd, request.boundary?.cwd, ...(request.boundary?.writableRoots ?? [])])
            if (path)
                this.assertLaneAvailable(path);
    }
    assertLaneAvailable(cwd) {
        for (const lane of this.store.read().lanes.filter(item => item.owner))
            if (cwd === lane.path || cwd.startsWith(`${lane.path}/`) || lane.path.startsWith(`${cwd}/`))
                throw new Error("Managed lane is reserved; use codex_workflow dispatch");
    }
    allow(action) { return this.permitted.run(true, action); }
}
function finalText(items) {
    for (let index = items.length - 1; index >= 0; index--) {
        const item = items[index];
        if (typeof item === "string")
            continue;
        if (item && typeof item === "object") {
            const value = item, type = String(value.type ?? "").toLowerCase();
            if (type.includes("agent") || type.includes("message")) {
                const text = textValue(value.text ?? value.content);
                if (text)
                    return text;
            }
        }
    }
    return items.filter(item => typeof item === "string").join("");
}
function textValue(value) {
    if (typeof value === "string")
        return value;
    if (Array.isArray(value))
        return value.map(textValue).join("");
    if (value && typeof value === "object")
        return textValue(value.text);
    return "";
}
//# sourceMappingURL=workers.js.map