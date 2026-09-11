import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
