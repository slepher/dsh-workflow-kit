import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowConfiguration } from "../lib/configuration.js";
import { WorkflowStore } from "../lib/store.js";
import { WorkflowWorkers } from "../lib/workers.js";

/**
 * Compose a workflow Host around synthetic package configurations: two shipped
 * profiles (`a`, `b`) over one role set, with runtime-composed instructions.
 * @param t - the test context owning the temporary state directory.
 * @param options - child cwd, the role set both profiles carry, whether the
 *   installed provider publishes the controlled thread handover, the sourced
 *   fact projector, and per-child session events.
 * @returns the composed workers, fake native services, and captured calls.
 */
export function fixture(t, { cwd, roles = { reviewer: { provider: "codex", model: "model-a", reasoningEffort: "high" } }, threadHandoff = true, facts, sessionEvents } = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), "native-workflow-"));
  cwd ??= stateDir;
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const builtin = Object.fromEntries(["a", "b"].map(id => [id, { roles: Object.fromEntries(
    Object.entries(roles).map(([name, value]) => [name, id === "b" ? { ...value, model: "model-b" } : value])) }]));
  // The resolver records the phase prompts a capture appends, so a test can see
  // which phase text one execution was bound to.
  const configuration = new WorkflowConfiguration(builtin,
    (role, skills = []) => `${role === "reviewer" ? "Reviewer instructions" : `Execute ${role}`}${skills.length === 0 ? "" : ` [${skills.join(",")}]`}`);
  const store = new WorkflowStore(join(stateDir, "state"));
  const session = { id: "parent", header: { cwd } }, parent = { id: "parent", session, status: "running" };
  const agents = new Map([[parent.id, parent]]), sessions = new Map([[session.id, session]]), nativeFacts = new Map(), calls = [];
  const handoffs = new Map(), handoffCalls = [];
  /**
   * The provider-side handover stand-in: it records the target binding, refuses
   * a source that is not confirmed idle, and answers with the source's thread.
   */
  const handoffService = threadHandoff ? {
    async handoff(request) {
      handoffCalls.push(structuredClone(request));
      const source = nativeFacts.get(request.fromSessionId);
      if (source === undefined) throw new Error(`unknown handoff source ${request.fromSessionId}`);
      if (source.state !== "idle") throw new Error(`source ${request.fromSessionId} is ${source.state}`);
      const prior = handoffs.get(request.toSessionId);
      if (prior !== undefined && prior.requestId !== request.requestId) throw new Error("handoff successor identity is already in use");
      handoffs.set(request.toSessionId, { ...structuredClone(request), threadId: source.threadId });
      source.handedOff = { toSessionId: request.toSessionId, requestId: request.requestId };
      return { toSessionId: request.toSessionId, threadId: source.threadId, state: "idle" };
    },
    async read(id) {
      const row = nativeFacts.get(id);
      if (row === undefined) return undefined;
      const inbound = handoffs.get(id);
      return { sessionId: id, threadId: row.threadId, ...(row.handedOff === undefined ? {} : { handedOffTo: row.handedOff.toSessionId }),
        ...(inbound === undefined ? {} : { handoffFrom: inbound.fromSessionId }) };
    },
  } : undefined;
  const begin = (id, options, text) => {
    const previous = nativeFacts.get(id), number = (previous?.number ?? 0) + 1;
    const handoff = handoffs.get(id);
    // A successor's first request must carry exactly the execution the recorded
    // handover bound, the same invariant the real provider enforces. Role
    // instructions travel as prompt text, so the boundary is what the handover
    // and the child creation have to agree on.
    if (handoff !== undefined && previous === undefined
      && JSON.stringify(handoff.boundary) !== JSON.stringify(options.execution?.boundary)) {
      throw new Error("successor execution must match the recorded handover");
    }
    const childCwd = options?.execution?.boundary.cwd ?? previous?.cwd ?? cwd;
    const child = { id, session: { id, header: { parentSession: parent.id, cwd: childCwd },
      snapshotEvents: () => sessionEvents?.(id) ?? [] }, status: "running",
      options: { provider: options.provider, model: options.model,
        ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
        ...(options.execution === undefined ? {} : { execution: options.execution }) } };
    agents.set(id, child); sessions.set(id, child.session);
    nativeFacts.set(id, { nativeSessionId: id, number, threadId: previous?.threadId ?? handoff?.threadId ?? `thread-${id}`,
      turnId: `${id}:${number}`, cwd: childCwd, model: options.model, reasoningEffort: options.reasoningEffort,
      state: "running", reports: previous?.reports ?? [] });
    return `inbox-${id}-${number}`;
  };
  const execution = { async read(id) { return structuredClone(nativeFacts.get(id)); },
    ...(facts === undefined ? {} : { facts: async id => facts(String(id)) }) };
  /**
   * The provider's gate stand-in. It records every registration and, crucially,
   * whether the binding arrived before the child's first dispatch.
   */
  const gateHandlers = new Map(), gateBinds = [];
  const toolGate = {
    register(hook, handler) {
      assert.equal(gateHandlers.has(hook), false, `duplicate handler registration: ${hook}`);
      gateHandlers.set(hook, handler);
      return () => gateHandlers.delete(hook);
    },
    bind(sessionId, binding) {
      gateBinds.push({ sessionId, binding: structuredClone(binding), started: nativeFacts.has(sessionId) });
    },
  };
  /** Persisted session log seam: the live registry may no longer hold the child. */
  const persistence = { async open(id, mode) {
    assert.equal(mode, "read");
    return { async read() { return { events: sessionEvents?.(String(id)) ?? [] }; }, async close() {} };
  } };
  const ctx = { agents, sessions, get: name => name === "codexExecution" ? execution : name === "codexHandoff" ? handoffService
      : name === "codexToolGate" ? toolGate
      : name === "sessionPersistence" ? persistence : undefined,
    codexExecution: execution, codexToolGate: toolGate, ...(handoffService === undefined ? {} : { codexHandoff: handoffService }), subagents: {
    async startContinuable(spec) { calls.push(structuredClone({ id: spec.childId, options: spec.request.agentOptions, prompt: spec.request.prompt })); return { childId: spec.childId, messageId: begin(spec.childId, spec.request.agentOptions, spec.request.prompt) }; },
    async [Symbol.for("dsh.subagent.deliverPrompt")](_parent, id, content, _source, _signal, delivery) {
      calls.push({ id, delivery, content }); return begin(id, nativeFacts.get(id), content);
    },
    interrupt(id) { calls.push({ id, interrupt: true }); nativeFacts.get(id).state = "interrupt-requested"; },
  } };
  const workers = new WorkflowWorkers(ctx, store, configuration, () => "a", "/skills/codex-workflow", undefined);
  const run = operation => workers.run(parent, new AbortController().signal, operation);
  const create = async id => {
    const snapshot = workers.captureRole("reviewer");
    return workers.create(parent.id, { id, name: id, cwd, ...snapshot, managed: true,
      boundary: { cwd, writableRoots: [cwd], network: "disabled", ports: {} } });
  };
  const finish = (id, text = "deliverable") => {
    const row = nativeFacts.get(id); row.state = "idle";
    row.reports.push({ threadId: row.threadId, turnId: row.turnId, status: "completed", result: text, createdAt: Date.now() });
    agents.delete(id); sessions.delete(id);
  };
  /** The model-visible text one recorded dispatch delivered. */
  const promptText = call => (call.prompt ?? []).map(block => block.text ?? "").join("\n");
  return { workers, ctx, parent, store, facts: nativeFacts, calls, configuration, run, create, finish, handoffs, handoffCalls, promptText, persistence, toolGate, gateBinds };
}
