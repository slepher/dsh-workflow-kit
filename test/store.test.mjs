import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkflowStore } from "../lib/index.js";

test("ignores arbitrary legacy workflow data and leaves its bytes untouched", t => {
  const stateDir = mkdtempSync(join(tmpdir(), "workflow-legacy-store-"));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const file = join(stateDir, "workflow.json");
  const legacy = "{ damaged legacy worker/report data\n";
  writeFileSync(file, legacy);
  const store = new WorkflowStore(stateDir);
  assert.deepEqual(store.read(), { runs: [], lanes: [] });
  store.save();
  assert.equal(readFileSync(file, "utf8"), legacy);
  assert.deepEqual(JSON.parse(readFileSync(join(stateDir, "orchestration.json"), "utf8")), { runs: [], lanes: [] });
});

test("restores only new orchestration state", t => {
  const stateDir = mkdtempSync(join(tmpdir(), "workflow-empty-store-"));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const file = join(stateDir, "orchestration.json");
  writeFileSync(file, `${JSON.stringify({ runs: [{ id: "run" }], lanes: [{ path: "/lane" }] }, null, 2)}\n`);
  const store = new WorkflowStore(stateDir);
  assert.deepEqual(store.read(), { runs: [{ id: "run" }], lanes: [{ path: "/lane" }] });
  store.save();
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { runs: [{ id: "run" }], lanes: [{ path: "/lane" }] });
});

test("native Session selections persist independently and failed writes preserve selection", t => {
  const directory = mkdtempSync(join(tmpdir(), "workflow-selection-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new WorkflowStore(directory);
  assert.equal(store.selectedProfile("parent-a", "a"), "a");
  assert.equal(store.selectedProfile("parent-b"), undefined);
  store.selectProfile("parent-a", "b");
  const restored = new WorkflowStore(directory);
  assert.equal(restored.selectedProfile("parent-a", "new-default"), "b");
  assert.equal(restored.selectedProfile("parent-b", "new-default"), undefined);
  mkdirSync(join(directory, `orchestration.json.${process.pid}.tmp`));
  assert.throws(() => restored.selectProfile("parent-a", "a"));
  assert.equal(restored.selectedProfile("parent-a"), "b");
  assert.equal(new WorkflowStore(directory).selectedProfile("parent-a"), "b");
});

test("stores plan and lane references once and restores legacy and compact runs", t => {
  const directory = mkdtempSync(join(tmpdir(), "workflow-compact-store-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const snapshot = join(directory, "plan.json"), contract = join(directory, "contract.md");
  const plan = { repository: directory, text: "retained plan", tasks: { T001: { text: "current contract" } } };
  writeFileSync(snapshot, JSON.stringify(plan));
  writeFileSync(contract, "frozen contract");
  const lane = { name: "lane-01", path: join(directory, "agentwork/.lanes/lane-01"), owner: "T001-A1" };
  const run = { id: "run", planSnapshot: snapshot, plan, lanes: [lane],
    attempts: [{ task: { id: "T001", text: "frozen contract" }, contract, state: "running" }] };
  const file = join(directory, "orchestration.json");
  writeFileSync(file, JSON.stringify({ runs: [run, { ...run, id: "second" }], lanes: [lane] }));
  const legacy = new WorkflowStore(directory);
  assert.deepEqual(legacy.read().runs[0].plan, plan);
  legacy.save();
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(saved.runs[0].plan, undefined);
  assert.equal(saved.runs[0].lanes, undefined);
  assert.equal(saved.runs[0].attempts[0].task.text, undefined);
  assert.equal(saved.lanes.length, 1);
  const restored = new WorkflowStore(directory);
  assert.deepEqual(restored.read().runs[0].plan, plan);
  assert.deepEqual(restored.read().runs[0].lanes, [lane]);
  assert.equal(restored.read().runs[0].attempts[0].task.text, "frozen contract");
  assert.equal(restored.read().runs[0].lanes[0], restored.read().runs[1].lanes[0]);
  restored.selectProfile("parent", "profile");
  assert.equal(new WorkflowStore(directory).selectedProfile("parent"), "profile");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).runs[0].plan, undefined);
  rmSync(snapshot);
  assert.throws(() => new WorkflowStore(directory), { code: "ENOENT" }, "a missing snapshot must not reset stored runs");
  writeFileSync(snapshot, JSON.stringify(plan));
  rmSync(contract);
  assert.throws(() => new WorkflowStore(directory), { code: "ENOENT" }, "a missing contract must not reset stored runs");
});
