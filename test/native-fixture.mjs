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
 * @param options - child cwd and the role set both profiles carry.
 * @returns the composed workers, fake native services, and captured calls.
 */
export function fixture(t, { cwd, roles = { reviewer: { provider: "codex", model: "model-a", reasoningEffort: "high" } } } = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), "native-workflow-"));
  cwd ??= stateDir;
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const builtin = Object.fromEntries(["a", "b"].map(id => [id, { roles: Object.fromEntries(
    Object.entries(roles).map(([name, value]) => [name, id === "b" ? { ...value, model: "model-b" } : value])) }]));
  const configuration = new WorkflowConfiguration(builtin,
    role => role === "reviewer" ? "Reviewer instructions" : `Execute ${role}`);
  const store = new WorkflowStore(join(stateDir, "state"));
  const session = { id: "parent", header: { cwd } }, parent = { id: "parent", session, status: "running" };
  const agents = new Map([[parent.id, parent]]), sessions = new Map([[session.id, session]]), facts = new Map(), calls = [];
  const begin = (id, options, text) => {
    const previous = facts.get(id), number = (previous?.number ?? 0) + 1;
    const childCwd = options.execution?.boundary.cwd ?? previous?.cwd ?? cwd;
    const child = { id, session: { id, header: { parentSession: parent.id, cwd: childCwd } }, status: "running" };
    agents.set(id, child); sessions.set(id, child.session);
    facts.set(id, { nativeSessionId: id, number, threadId: `thread-${id}`, turnId: `${id}:${number}`, cwd: childCwd,
      model: options.model, reasoningEffort: options.reasoningEffort, state: "running", reports: previous?.reports ?? [] });
    return `inbox-${id}-${number}`;
  };
  const ctx = { agents, sessions, codexExecution: { async read(id) { return structuredClone(facts.get(id)); } }, subagents: {
    async startContinuable(spec) { calls.push(structuredClone({ id: spec.childId, options: spec.request.agentOptions, prompt: spec.request.prompt })); return { childId: spec.childId, messageId: begin(spec.childId, spec.request.agentOptions, spec.request.prompt) }; },
    async [Symbol.for("dsh.subagent.deliverPrompt")](_parent, id, content, _source, _signal, delivery) {
      calls.push({ id, delivery, content }); return begin(id, facts.get(id), content);
    },
    interrupt(id) { calls.push({ id, interrupt: true }); facts.get(id).state = "interrupt-requested"; },
  } };
  const workers = new WorkflowWorkers(ctx, store, configuration, () => "a", "/skills/codex-workflow");
  const run = operation => workers.run(parent, new AbortController().signal, operation);
  const create = async id => {
    const snapshot = workers.captureRole("reviewer");
    return workers.create(parent.id, { id, name: id, cwd, ...snapshot, managed: true,
      boundary: { cwd, writableRoots: [cwd], network: "disabled", ports: {} } });
  };
  const finish = (id, text = "deliverable") => {
    const row = facts.get(id); row.state = "idle";
    row.reports.push({ threadId: row.threadId, turnId: row.turnId, status: "completed", result: text, createdAt: Date.now() });
    agents.delete(id); sessions.delete(id);
  };
  return { workers, ctx, parent, store, facts, calls, configuration, run, create, finish };
}
