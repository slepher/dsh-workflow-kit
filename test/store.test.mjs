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
