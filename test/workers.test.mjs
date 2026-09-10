import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WorkflowStore, Workers } from "../lib/index.js";
import { Backend } from "./backend.mjs";

test("terminal reports survive a missed live event and ack remains separate from acceptance", async t => {
  const stateDir = mkdtempSync(join(tmpdir(), "workflow-workers-")); t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const backend = new Backend(), store = new WorkflowStore(stateDir);
  let workers = new Workers(backend, store, "/skills/codex-workflow");
  const worker = await workers.create("parent", { name: "A", cwd: "/work" });
  const running = await workers.append("parent", worker.id, "task");
  await workers.close();
  backend.complete("workflow:parent", worker.id, running.turnId, "exact final reply");
  workers = new Workers(backend, new WorkflowStore(stateDir), "/skills/codex-workflow");
  await workers.reconcileAll();
  assert.equal(workers.pending("parent").length, 1);
  assert.equal(workers.pending("parent")[0].result, "exact final reply");
  workers.acknowledge("parent", worker.id, running.turnId);
  assert.equal(workers.get("parent", worker.id).reports[0].acceptance, "pending");
  workers.accept("parent", worker.id, running.turnId, "accepted");
  assert.equal(workers.get("parent", worker.id).reports[0].acceptance, "accepted");
  assert.equal(workers.get("parent", worker.id).reports.length, 1);
  await workers.close();
});

test("global guard blocks managed workers and reserved lanes across owners", async t => {
  const stateDir = mkdtempSync(join(tmpdir(), "workflow-guard-")); t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const backend = new Backend(), store = new WorkflowStore(stateDir), workers = new Workers(backend, store, "/skills/codex-workflow");
  store.read().lanes.push({ path: "/repo/lane-01", owner: "T001-A1" }); store.save();
  await assert.rejects(backend.createSession("codex:foreign", "foreign", "/repo/lane-01/subdir"), /reserved/);
  await assert.rejects(backend.createSession("codex:foreign", "ancestor", "/repo"), /reserved/);
  await assert.rejects(backend.createSession("codex:foreign", "boundary", "/elsewhere", { boundary: { cwd: "/elsewhere", writableRoots: ["/repo/lane-01"], network: "disabled" } }), /reserved/);
  const managed = await workers.create("parent", { name: "managed", cwd: "/other", managed: true });
  await assert.rejects(backend.startTurn("workflow:parent", managed.id, "bypass"), /requires codex_workflow/);
  await workers.append("parent", managed.id, "allowed", true);
  await assert.rejects(workers.interrupt("parent", managed.id, workers.get("parent", managed.id).turnId), /requires codex_workflow/);
  await assert.rejects(workers.resume("parent", managed.id), /requires codex_workflow/);
  await workers.close();
});

test("unknown terminal ownership is durable and is not treated as idle", async t => {
  const stateDir = mkdtempSync(join(tmpdir(), "workflow-unknown-")); t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const backend = new Backend(), workers = new Workers(backend, new WorkflowStore(stateDir), "/skills/codex-workflow");
  const worker = await workers.create("parent", { name: "A", cwd: "/work" }), running = await workers.append("parent", worker.id, "task");
  backend.push("workflow:parent", worker.id, { type: "turn.state", turn: { sessionId: worker.id, threadId: worker.threadId, turnId: running.turnId, state: "unknown" } });
  assert.equal(workers.get("parent", worker.id).state, "unknown"); assert.equal(workers.pending("parent")[0].status, "unknown");
  await assert.rejects(workers.closeWorker("parent", worker.id), /idle/); await workers.close();
});

test("uncertain create retains its identity instead of inviting a duplicate", async t => {
  const stateDir = mkdtempSync(join(tmpdir(), "workflow-create-")); t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const backend = new Backend(); backend.createSession = async () => { throw new Error("uncertain"); };
  const workers = new Workers(backend, new WorkflowStore(stateDir), "/skills/codex-workflow");
  await assert.rejects(workers.create("parent", { id: "fixed", name: "A", cwd: "/work" }), /uncertain/);
  assert.equal(workers.get("parent", "fixed").state, "unknown"); await workers.close();
});
