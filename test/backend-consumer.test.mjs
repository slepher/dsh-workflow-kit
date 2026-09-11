import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexSessionBackend } from "dsh-codex-kit-backend";
import { WorkflowStore, WorkflowWorkers } from "../lib/index.js";

class Server extends EventEmitter {
  calls = []; turn = 0;
  constructor(hub) { super(); this.hub = hub; hub.servers.push(this); }
  async connect() {}
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === "thread/start") { this.threadId = `thread-${++this.hub.thread}`; return { thread: { id: this.threadId }, model: params.model, reasoningEffort: params.config?.model_reasoning_effort }; }
    if (method === "thread/resume") { this.threadId = params.threadId; return { thread: { id: params.threadId, status: { type: "idle" }, turns: [] }, model: params.model, reasoningEffort: params.config?.model_reasoning_effort }; }
    if (method === "turn/start") { const id = `turn-${++this.turn}`; this.emit("notification", { method: "turn/started", params: { threadId: params.threadId, turn: { id } } }); return { turn: { id, status: "inProgress" } }; }
    return {};
  }
  respond() {} reject() {} async close() {}
}

const caller = { nativeSessionId: "parent", source: "agent", parentAgent: { id: "agent", nativeSessionId: "parent" } };
const role = { name: "evidence_runner", developerInstructions: "Collect exact evidence", model: "gpt-5.6-luna", reasoningEffort: "medium" };
const complete = (server, threadId, turnId, text) => {
  server.emit("notification", { method: "item/completed", params: { threadId, turnId, item: { type: "agentMessage", phase: "final_answer", text } } });
  server.emit("notification", { method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};

function consumer(backend, store) {
  const registration = backend.registerWorkflow({ listRoles: () => [role], resolveRole: name => name === role.name ? role : (() => { throw new Error("Unknown role"); })(), authorize() {} });
  return { registration, workers: new WorkflowWorkers(backend, store, (actual, id, action, operation) => registration.run(actual, id, action, operation), "/skills") };
}

test("stateless Workflow adapter uses B as the only worker and report fact source", async t => {
  const root = mkdtempSync(join(tmpdir(), "workflow-backend-consumer-")), stateDir = join(root, "backend"), workflowDir = join(root, "workflow"), cwd = join(root, "cwd");
  const { mkdirSync } = await import("node:fs"); mkdirSync(cwd);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const hub = { servers: [], thread: 0 }, backend = new CodexSessionBackend(stateDir, () => new Server(hub)), store = new WorkflowStore(workflowDir);
  const { workers } = consumer(backend, store);
  let checks = 0;
  await workers.run(caller, () => { checks++; }, async () => {
    const created = await workers.create("parent", { id: "managed", name: "Managed", cwd, role: role.name, managed: true });
    assert.equal(created.managedBy, "workflow");
    const running = await workers.append("parent", created.id, "inspect", true);
    const server = hub.servers.find(value => value.threadId === running.threadId);
    complete(server, running.threadId, running.turnId, "exact final reply");
    const report = await workers.report("parent", running.id, running.turnId);
    assert.equal(report.result, "exact final reply");
    await assert.rejects(backend.acceptReport(caller, running.id, running.turnId, "accepted"), /requires codex_workflow/);
    const accepted = await workers.accept("parent", running.id, running.turnId, "accepted", true);
    assert.equal(accepted.acceptance, "accepted");
  });
  assert.ok(checks > 1, "identity is rechecked across backend awaits");
  store.save();
  assert.equal("workers" in JSON.parse(readFileSync(join(workflowDir, "orchestration.json"), "utf8")), false, "W persists no worker/report mirror");
  await backend.close();

  const reloaded = new CodexSessionBackend(stateDir, () => new Server({ servers: [], thread: 0 })), reopenedStore = new WorkflowStore(workflowDir), reopened = consumer(reloaded, reopenedStore).workers;
  await reopened.run(caller, () => {}, async () => assert.equal((await reopened.get("parent", "managed")).reports[0].acceptance, "accepted"));
  await reloaded.close();
});

test("legacy W worker data is ignored while managed facts go only to B", async t => {
  const root = mkdtempSync(join(tmpdir(), "workflow-legacy-consumer-")), stateDir = join(root, "backend"), workflowDir = join(root, "workflow"), cwd = join(root, "cwd");
  const { mkdirSync } = await import("node:fs"); mkdirSync(workflowDir); mkdirSync(cwd);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(workflowDir, "workflow.json"), legacy = `${JSON.stringify({ workers: [{ id: "old" }], runs: [], lanes: [] }, null, 2)}\n`; writeFileSync(file, legacy);
  const hub = { servers: [], thread: 0 }, backend = new CodexSessionBackend(stateDir, () => new Server(hub)), { workers } = consumer(backend, new WorkflowStore(workflowDir));
  const created = await workers.run(caller, () => {}, () => workers.create("parent", { id: "new", name: "New", cwd, role: role.name, managed: true }));
  assert.equal(created.managedBy, "workflow"); assert.equal(readFileSync(file, "utf8"), legacy);
  workers.store.save();
  assert.equal("workers" in JSON.parse(readFileSync(join(workflowDir, "orchestration.json"), "utf8")), false);
  await backend.close();
});
