import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installDelivery, WorkflowStore, Workers } from "../lib/index.js";
import { Backend } from "./backend.mjs";

test("busy delivery enters at a step boundary and reload reoffers until ack", async t => {
  const stateDir = mkdtempSync(join(tmpdir(), "workflow-delivery-")); t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const backend = new Backend(), workers = new Workers(backend, new WorkflowStore(stateDir), "/skills/codex-workflow");
  const notices = [], handlers = new Map(), agent = { id: "agent", session: { id: "parent" }, status: "running", followup: message => notices.push(message) };
  const host = { agents: { list: () => [agent], get: () => agent }, on: (name, handler) => { handlers.set(name, handler); return () => handlers.delete(name); } };
  let dispose = installDelivery(host, workers);
  const worker = await workers.create("parent", { name: "A", cwd: "/work" }), running = await workers.append("parent", worker.id, "task");
  backend.complete("workflow:parent", worker.id, running.turnId, "busy result"); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(notices.length, 0);
  const decision = await handlers.get("agent/pre-step")({ agent, signal: new AbortController().signal }, async () => ({ kind: "enter", messages: [] }));
  assert.match(JSON.stringify(decision.messages), /busy result/);
  agent.status = "idle"; handlers.get("agent/status")({ agent, status: "idle" }); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(notices.length, 0);
  dispose(); dispose = installDelivery(host, workers); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(notices.length, 1);
  workers.acknowledge("parent", worker.id, running.turnId); dispose(); await workers.close();
});
