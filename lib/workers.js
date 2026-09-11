import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { conversation } from "./conversation.js";
import { resolveRole } from "./roles.js";
import { parseUsage } from "./types.js";
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
    async append(parentId, id, text, managed = false) {
        this.managed(managed);
        const worker = await this.get(parentId, id);
        if (!text.trim() || worker.state !== "idle")
            throw new Error(`Worker is ${worker.state}; use steer for an active turn`);
        const caller = this.caller(parentId);
        await this.mutate(caller, id, "start", () => this.backend.startTurn(caller, id, text, { idempotencyKey: `${id}:${worker.reports.length + 1}` }));
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
    publicItems = new Map();
    constructor(backend, store, workflowSkillDir, implementationStandardDir) {
        super();
        this.backend = backend;
        this.store = store;
        this.workflowSkillDir = workflowSkillDir;
        this.implementationStandardDir = implementationStandardDir;
        this.guards.set("global", this.backend.installGuard(request => this.guard(request)));
        for (const worker of (store.read().workers ?? []).filter(item => !item.closed))
            this.watch(worker);
    }
    list(parentId) { return (this.store.read().workers ?? []).filter(worker => worker.parentId === parentId && !worker.closed && !worker.detached); }
    get(parentId, id) {
        const worker = this.list(parentId).find(item => item.id === id);
        if (!worker)
            throw new Error("Worker not found");
        return worker;
    }
    pending(parentId) { return this.list(parentId).filter(worker => worker.owner !== "user").flatMap(worker => worker.reports.filter(report => !report.acknowledgedAt)); }
    async create(parentId, input) {
        if (!parentId || !input.name.trim())
            throw new Error("Parent and worker name are required");
        if (!input.managed)
            this.assertLaneAvailable(input.cwd);
        const role = input.role ? resolveRole(input.role, this.workflowSkillDir, this.implementationStandardDir) : undefined;
        const id = input.id ?? randomUUID();
        if ((this.store.read().workers ?? []).some(worker => worker.id === id))
            throw new Error("Worker identity already exists");
        const worker = {
            id, parentId, name: input.name, cwd: input.cwd, role: role?.name,
            model: role?.model ?? input.model, effort: role?.effort ?? input.effort,
            state: "unknown", managed: input.managed === true,
            lastEventSequence: 0, reports: [], output: {}, owner: input.owner ?? "agent",
        };
        (this.store.read().workers ??= []).push(worker);
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
    occupiedThreads() {
        return new Set((this.store.read().workers ?? []).filter(worker => !worker.detached || !["idle", "saved"].includes(worker.state) || worker.savedState !== "idle").flatMap(worker => worker.threadId ? [worker.threadId] : []));
    }
    async adopt(parentId, threadId) {
        if (this.occupiedThreads().has(threadId))
            throw new Error("This Codex session is already occupied");
        const existing = (this.store.read().workers ?? []).find(worker => worker.threadId === threadId && worker.detached && worker.state === "saved" && worker.savedState === "idle");
        if (existing) {
            existing.parentId = parentId;
            existing.owner = "user";
            existing.detached = false;
            this.store.save();
            this.watch(existing);
            return structuredClone(existing);
        }
        const id = randomUUID();
        const session = await this.allow(() => this.backend.importSession(owner(parentId), id, threadId));
        const worker = {
            id, parentId, owner: "user", name: threadId, cwd: session.cwd,
            model: session.model, effort: session.reasoningEffort, threadId,
            state: "saved", savedState: "idle", managed: false,
            lastEventSequence: 0, reports: [], output: {},
        };
        (this.store.read().workers ??= []).push(worker);
        this.store.save();
        this.watch(worker);
        return structuredClone(worker);
    }
    link(parentId, id) {
        const worker = this.get(parentId, id);
        if (worker.owner !== "user")
            throw new Error("Only a user conversation can be linked");
        worker.owner = "agent";
        for (const report of worker.reports)
            report.acknowledgedAt ??= new Date().toISOString();
        this.store.save();
        return structuredClone(worker);
    }
    async detach(parentId, id) {
        const worker = this.get(parentId, id);
        if (worker.owner !== "user")
            throw new Error("Only user conversations can be removed from this group");
        if (worker.state === "idle" || worker.state === "saved" && worker.savedState === "idle") {
            await this.allow(() => this.backend.closeSession(owner(parentId), id));
            worker.state = "saved";
            worker.savedState = "idle";
            this.subscriptions.get(id)?.();
            this.subscriptions.delete(id);
        }
        worker.detached = true;
        this.store.save();
        this.emit("changed", worker);
    }
    async append(parentId, id, text, managed = false, skills = []) {
        const worker = this.get(parentId, id);
        if (worker.managed !== managed)
            throw new Error("Managed workflow worker requires codex_workflow");
        if (!text.trim() || worker.state !== "idle")
            throw new Error(`Worker is ${worker.state}; use steer for an active turn`);
        const key = `${worker.id}:${worker.reports.length + 1}`;
        const options = { model: worker.model, reasoningEffort: worker.effort, idempotencyKey: key };
        worker.turnUsageStart = worker.usage ? structuredClone(worker.usage.total) : undefined;
        worker.state = "running";
        this.store.save();
        try {
            const turn = await this.allow(() => this.backend.startTurn(owner(parentId), id, [{ type: "text", text }, ...skills.map(skill => ({ type: "skill", name: skill.name, path: skill.path }))], options));
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
    async steer(parentId, id, turnId, text, managed = false, skills = []) {
        const worker = this.get(parentId, id);
        this.managed(worker, managed);
        this.expectedTurn(worker, turnId);
        await this.allow(() => this.backend.steerTurn(owner(parentId), turnId, [{ type: "text", text }, ...skills.map(skill => ({ type: "skill", name: skill.name, path: skill.path }))]));
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
        if (session.usage)
            worker.usage = parseUsage(session.usage);
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
    async compact(parentId, id) {
        const worker = this.get(parentId, id);
        this.managed(worker, false);
        if (worker.state !== "idle")
            throw new Error("Wait for the current turn before compacting");
        const operation = { id: randomUUID(), turnId: null, status: "inProgress" };
        (worker.compactions ??= []).push(operation);
        worker.usageResetPending = true;
        worker.state = "starting";
        this.store.save();
        try {
            await this.allow(() => this.backend.compactSession(owner(parentId), id));
        }
        catch (error) {
            operation.status = "unknown";
            operation.error = String(error);
            worker.state = "unknown";
            this.store.save();
            throw error;
        }
        return structuredClone(worker);
    }
    async review(parentId, id) {
        const worker = this.get(parentId, id);
        this.managed(worker, false);
        worker.turnUsageStart = worker.usage ? structuredClone(worker.usage.total) : undefined;
        const turn = await this.allow(() => this.backend.reviewSession(owner(parentId), id));
        worker.threadId = turn.threadId;
        worker.turnId = turn.turnId;
        worker.state = turn.state;
        worker.output[turn.turnId] ??= [];
        this.store.save();
        return structuredClone(worker);
    }
    async approve(parentId, id, approvalId, decision) {
        const worker = this.get(parentId, id);
        await this.allow(() => this.backend.decideApproval(owner(parentId), approvalId, decision));
        worker.approvals = (worker.approvals ?? []).filter(item => item.id !== approvalId);
        if (worker.state === "waiting-approval")
            worker.state = "running";
        this.store.save();
        this.emit("changed", worker);
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
    async reconcileAll() { for (const worker of (this.store.read().workers ?? []).filter(item => !item.closed))
        await this.reconcile(worker); }
    async close() { for (const off of this.subscriptions.values())
        off(); this.subscriptions.clear(); for (const off of this.guards.values())
        off(); this.guards.clear(); this.publicItems.clear(); }
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
            if (event.operation === "compact") {
                const operation = worker.compactions?.find(item => item.turnId === null || item.turnId === event.turn.turnId);
                if (operation && terminal.has(event.turn.state)) {
                    operation.turnId = event.turn.turnId;
                    operation.status = event.turn.state;
                    operation.error = event.error;
                }
            }
            else if (terminal.has(event.turn.state))
                this.complete(worker, event.turn.turnId, event.turn.state, event.finalOutput, event.error);
        }
        else if (event.type === "approval.requested") {
            worker.state = "waiting-approval";
            worker.approvals = [...(worker.approvals ?? []).filter(item => item.id !== event.request.requestId), { id: event.request.requestId, method: event.request.method, params: event.request.params }];
        }
        else if (event.type === "usage.updated") {
            const usage = parseUsage(event.usage), previous = worker.rawUsageTotal ?? worker.usage?.total;
            if (worker.usageResetPending && usage.total.totalTokens !== null && previous?.totalTokens != null && usage.total.totalTokens < previous.totalTokens) {
                worker.usageOffset = structuredClone(worker.usage.total);
                worker.usageResetPending = false;
            }
            worker.rawUsageTotal = structuredClone(usage.total);
            if (worker.usageOffset)
                usage.total = Object.fromEntries(Object.entries(usage.total).map(([key, value]) => {
                    const offset = worker.usageOffset[key];
                    return [key, value !== null && offset !== null ? value + offset : null];
                }));
            worker.usage = usage;
        }
        else if (event.type === "thread.notification")
            this.conversationEvent(worker, event.method, event.params);
        this.store.save();
        this.emit("changed", worker);
    }
    conversationEvent(worker, method, params) {
        const value = params && typeof params === "object" ? params : {};
        const items = this.publicItems.get(worker.id) ?? new Map();
        this.publicItems.set(worker.id, items);
        if ((method === "item/started" || method === "item/completed") && value.item && value.turnId) {
            const item = conversation({ turns: [{ id: value.turnId, items: [{ ...value.item, status: value.item.status ?? (method === "item/started" ? "inProgress" : "completed") }] }] }).items[0];
            if (item) {
                items.set(item.id, item);
                this.emit("conversation", worker.parentId, worker.id, { type: "item", item });
            }
        }
        else if ((method === "item/agentMessage/delta" || method === "item/commandExecution/outputDelta") && typeof value.itemId === "string" && typeof value.turnId === "string" && typeof value.delta === "string") {
            const role = method.includes("agentMessage") ? "assistant" : "tool";
            const previous = items.get(value.itemId) ?? { id: value.itemId, turnId: value.turnId, role, text: "" };
            const item = { ...previous, text: previous.text + value.delta, ...(role === "tool" ? { output: (previous.output ?? "") + value.delta } : {}) };
            items.set(item.id, item);
            this.emit("conversation", worker.parentId, worker.id, { type: "item", item });
        }
        else if ((method === "turn/started" || method === "turn/completed") && value.turn) {
            this.emit("conversation", worker.parentId, worker.id, { type: "turn", turn: conversation({ turns: [value.turn] }).turns?.[0] });
        }
    }
    complete(worker, turnId, status, finalOutput, error) {
        if (worker.reports.some(report => report.turnId === turnId)) {
            delete worker.output[turnId];
            return;
        }
        const result = finalOutput ?? finalText(worker.output[turnId] ?? []);
        const report = { workerId: worker.id, threadId: worker.threadId, turnId, status, result, createdAt: new Date().toISOString(), acceptance: "pending", usage: structuredClone(worker.usage),
            ...(!result && status === "completed" ? { protocolError: "Result missing: completed turn has no deliverable final_answer; ask the same worker to supply its result without repeating the task" } : {}),
            ...(error ? { error } : {}) };
        if (worker.turnUsageStart && worker.usage)
            report.turnUsage = Object.fromEntries(Object.entries(worker.usage.total).map(([key, value]) => {
                const start = worker.turnUsageStart[key];
                return [key, typeof value === "number" && typeof start === "number" && value >= start ? value - start : null];
            }));
        delete worker.turnUsageStart;
        worker.reports.push(report);
        delete worker.output[turnId];
        this.store.save();
        if (worker.owner !== "user")
            this.emit("report", report, worker.parentId);
    }
    guard(request) {
        if (this.permitted.getStore())
            return;
        const managed = request.sessionId && (this.store.read().workers ?? []).some(worker => worker.id === request.sessionId && worker.managed && !worker.closed);
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
    return "";
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