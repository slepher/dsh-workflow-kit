import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildGateArgs, gateBinding, patchTargets, pathGrant, readGateArgs, resolvedTarget, within, workflowGateHandler,
  writeTargets, GATE_DENY_PREFIX, WORKFLOW_GATE_HOOK,
} from "../lib/gate.js";
import { WorkflowStore } from "../lib/store.js";

/**
 * One repository fixture with a lane, a neighbouring look-alike lane, a shared
 * document directory, an artifacts directory and a symlink that leaves the lane.
 */
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "workflow-gate-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lane = join(root, "agentwork", "goal", ".lanes", "lane-01");
  const other = join(root, "agentwork", "goal", ".lanes", "lane-other");
  const outside = join(root, "outside");
  const shared = join(root, "docs");
  const artifacts = join(root, "agentwork", "goal", "generation-1", ".artifacts", "T1-A1", "worker");
  for (const path of [join(lane, "src"), join(lane, "src-old"), join(other, "src"), outside, shared, artifacts]) mkdirSync(path, { recursive: true });
  writeFileSync(join(lane, "src", "a.ts"), "export const a = 1\n");
  writeFileSync(join(lane, "src", "b.ts"), "export const b = 1\n");
  writeFileSync(join(lane, "src-old", "c.ts"), "old\n");
  writeFileSync(join(other, "src", "d.ts"), "other\n");
  writeFileSync(join(shared, "summary.md"), "# summary\n");
  writeFileSync(join(shared, "other.md"), "# other\n");
  writeFileSync(join(outside, "secret.ts"), "secret\n");
  symlinkSync(outside, join(lane, "src", "escape"));
  return { root, lane, other, outside, shared, artifacts, source: join(lane, "src") };
}

/** A coding worker bound to one owned file, its artifacts and no shared document. */
function coding(f, { productWrites = [join(f.lane, "src", "a.ts")], auxiliaryWrites = [f.artifacts], sharedWrites = [] } = {}) {
  return gateBinding("coding_worker", buildGateArgs({ cwd: f.lane, lane: f.lane, productWrites, auxiliaryWrites, sharedWrites }));
}

const event = (toolName, toolArgs, cwd) => ({ source: "dsh", sessionId: "child", callId: "call", cwd, toolName, toolArgs });

/** Whether one call is allowed. */
const allowed = (binding, toolName, toolArgs, cwd) => workflowGateHandler(binding, event(toolName, toolArgs, cwd)).kind === "allow";

/** The denial reason, asserting the call was denied and prefixed for log matching. */
function denial(binding, toolName, toolArgs, cwd) {
  const decision = workflowGateHandler(binding, event(toolName, toolArgs, cwd));
  assert.equal(decision.kind, "deny", `${toolName} ${JSON.stringify(toolArgs)} was allowed`);
  assert.ok(decision.reason.startsWith(GATE_DENY_PREFIX), `denial is not prefixed: ${decision.reason}`);
  return decision.reason;
}

test("G01/G02/G03: a granted product file is allowed and every look-alike neighbour is not", t => {
  const f = fixture(t);
  const binding = coding(f);
  assert.equal(allowed(binding, "edit", { file_path: join(f.lane, "src", "a.ts") }, f.lane), true);
  assert.match(denial(binding, "edit", { file_path: join(f.lane, "src", "b.ts") }, f.lane), /outside assigned paths/);
  // A name-prefix neighbour is not a path descendant.
  assert.match(denial(binding, "edit", { file_path: join(f.lane, "src-old", "c.ts") }, f.lane), /outside assigned paths/);
  assert.match(denial(binding, "write", { file_path: join(f.other, "src", "d.ts") }, f.lane), /outside assigned paths/);
});

test("G04: traversal, an absolute outside path and a symlink out of the lane are refused", t => {
  const f = fixture(t);
  const binding = coding(f, { productWrites: [f.source] });
  assert.match(denial(binding, "write", { file_path: "../../outside/secret.ts" }, f.lane), /outside assigned paths/);
  assert.match(denial(binding, "write", { file_path: join(f.outside, "secret.ts") }, f.lane), /outside assigned paths/);
  // The lexical path is inside the granted directory; only the resolved path leaves it.
  const reason = denial(binding, "write", { file_path: join(f.source, "escape", "secret.ts") }, f.lane);
  assert.match(reason, /resolves outside assigned paths/);
  assert.equal(allowed(binding, "write", { file_path: join(f.source, "inside.ts") }, f.lane), true);
});

test("G05: a new file is allowed by its exact grant and a neighbouring new file is not", t => {
  const f = fixture(t);
  const target = join(f.lane, "src", "new.ts");
  const binding = coding(f, { productWrites: [target] });
  assert.equal(allowed(binding, "write", { file_path: target, content: "x" }, f.lane), true);
  assert.match(denial(binding, "write", { file_path: join(f.lane, "src", "newer.ts"), content: "x" }, f.lane), /outside assigned paths/);
});

test("G06: a patch with one unauthorized file refuses the whole call", t => {
  const f = fixture(t);
  const binding = coding(f);
  const patch = [
    "*** Begin Patch",
    `*** Add File: ${join(f.lane, "src", "new.ts")}`,
    "+export const n = 1",
    `*** Update File: ${join(f.lane, "src", "b.ts")}`,
    "@@",
    "-export const b = 1",
    "+export const b = 2",
    "*** End Patch",
  ].join("\n");
  const reason = denial(binding, "apply_patch", { command: patch }, f.lane);
  assert.match(reason, /outside assigned paths/);
});

test("G07: a move checks both the source and the destination", t => {
  const f = fixture(t);
  const source = join(f.lane, "src", "a.ts");
  const inside = join(f.lane, "src", "renamed.ts");
  const outside = join(f.other, "src", "moved.ts");
  const binding = coding(f, { productWrites: [source, inside] });
  const move = to => ["*** Begin Patch", `*** Update File: ${source}`, `*** Move to: ${to}`, "@@", "-export const a = 1", "+export const a = 2", "*** End Patch"].join("\n");
  assert.equal(allowed(binding, "apply_patch", { command: move(inside) }, f.lane), true);
  assert.match(denial(binding, "apply_patch", { command: move(outside) }, f.lane), /outside assigned paths/);
  // The destination is granted, the source is not.
  const reversed = coding(f, { productWrites: [inside] });
  assert.match(denial(reversed, "apply_patch", { command: move(inside) }, f.lane), /outside assigned paths/);
  // A move with no Update directive is not attributable and is refused.
  assert.match(denial(binding, "apply_patch", { command: ["*** Begin Patch", `*** Move to: ${inside}`, "*** End Patch"].join("\n") }, f.lane), /no Update directive/);
});

test("G08: deleting a granted file is allowed and deleting an ungranted one is not", t => {
  const f = fixture(t);
  const binding = coding(f);
  const remove = path => ["*** Begin Patch", `*** Delete File: ${path}`, "*** End Patch"].join("\n");
  assert.equal(allowed(binding, "apply_patch", { command: remove(join(f.lane, "src", "a.ts")) }, f.lane), true);
  assert.match(denial(binding, "apply_patch", { command: remove(join(f.lane, "src", "b.ts")) }, f.lane), /outside assigned paths/);
});

test("G09: an explicitly shared document is writable and an unshared sibling is not", t => {
  const f = fixture(t);
  const binding = gateBinding("planner", buildGateArgs({ cwd: f.root, productWrites: [],
    auxiliaryWrites: [f.artifacts], sharedWrites: [join(f.shared, "summary.md")] }));
  assert.equal(allowed(binding, "write", { file_path: join(f.shared, "summary.md") }, f.root), true);
  assert.match(denial(binding, "write", { file_path: join(f.shared, "other.md") }, f.root), /outside assigned paths/);
});

test("G10: the editor's view is a read and its write commands check the path", t => {
  const f = fixture(t);
  const binding = coding(f);
  assert.equal(allowed(binding, "str_replace_editor", { command: "view", path: join(f.other, "src", "d.ts") }, f.lane), true);
  assert.equal(allowed(binding, "str_replace_editor", { command: "str_replace", path: join(f.lane, "src", "a.ts") }, f.lane), true);
  assert.match(denial(binding, "str_replace_editor", { command: "insert", path: join(f.lane, "src", "b.ts") }, f.lane), /outside assigned paths/);
  assert.match(denial(binding, "str_replace_editor", { command: "create", path: join(f.lane, "src", "c.ts") }, f.lane), /outside assigned paths/);
});

test("G11: the manager is refused every known shell entry point", t => {
  const f = fixture(t);
  const binding = gateBinding("manager", buildGateArgs({ cwd: f.root, productWrites: [], auxiliaryWrites: [f.artifacts], sharedWrites: [join(f.shared, "summary.md")] }));
  for (const name of ["bash", "pwsh", "Bash", "exec_command", "shell", "shell_command", "write_stdin"]) {
    assert.match(denial(binding, name, { command: "pytest -q" }, f.root), /manager does not run/, name);
  }
});

test("G12: the manager's own workflow actions pass this gate", t => {
  const f = fixture(t);
  const binding = gateBinding("manager", buildGateArgs({ cwd: f.root, productWrites: [], auxiliaryWrites: [f.artifacts], sharedWrites: [join(f.shared, "summary.md")] }));
  for (const action of ["status", "dispatch", "integrate", "record-result", "accept", "release", "complete"]) {
    assert.equal(allowed(binding, "codex_workflow", { action }, f.root), true, action);
  }
  assert.equal(allowed(binding, "write", { file_path: join(f.shared, "summary.md") }, f.root), true);
  assert.match(denial(binding, "write", { file_path: join(f.lane, "src", "a.ts") }, f.root), /outside assigned paths/);
});

test("G13: a consultation has no product grant but keeps its own artifacts", t => {
  const f = fixture(t);
  const consultation = gateBinding("coding_worker", buildGateArgs({ cwd: f.lane, lane: f.lane, productWrites: [], auxiliaryWrites: [f.artifacts] }));
  assert.match(denial(consultation, "write", { file_path: join(f.lane, "src", "a.ts") }, f.lane), /outside assigned paths/);
  assert.equal(allowed(consultation, "write", { file_path: join(f.artifacts, "answer.md") }, f.lane), true);
});

test("G14: a worker's shell is allowed — this gate does not read its file effects", t => {
  const f = fixture(t);
  const binding = coding(f);
  assert.equal(allowed(binding, "bash", { command: "rm -rf /tmp/whatever && npm test" }, f.lane), true);
  assert.equal(allowed(binding, "Bash", { command: "echo x > outside.txt" }, f.lane), true);
});

test("G15/G16: unknown tools are untouched and unreadable known write tools are refused", t => {
  const f = fixture(t);
  const binding = coding(f);
  assert.equal(allowed(binding, "todo_write", { todos: [] }, f.lane), true);
  assert.equal(allowed(binding, "present", { files: [] }, f.lane), true);
  assert.equal(allowed(binding, "some_future_tool", { file_path: join(f.outside, "secret.ts") }, f.lane), true);
  assert.match(denial(binding, "write", { content: "x" }, f.lane), /names no path/);
  assert.match(denial(binding, "edit", { file_path: 7 }, f.lane), /names no path/);
  assert.match(denial(binding, "str_replace_editor", { command: "rename", path: join(f.lane, "src", "a.ts") }, f.lane), /command "rename" is unknown/);
  assert.match(denial(binding, "apply_patch", { command: "not a patch" }, f.lane), /no \*\*\* Begin Patch marker/);
});

test("a file write without a usable cwd is refused rather than guessed", t => {
  const f = fixture(t);
  const binding = coding(f);
  assert.match(denial(binding, "write", { file_path: join(f.lane, "src", "a.ts") }, ""), /no working directory/);
  assert.match(denial(binding, "write", { file_path: join(f.lane, "src", "a.ts") }, f.other), /is not the assigned cwd/);
  // A shell call needs no cwd: this gate does not resolve anything for it.
  assert.equal(allowed(binding, "bash", { command: "true" }, ""), true);
});

test("the binding's role never interprets the provider's vocabulary", t => {
  const f = fixture(t);
  // Any label is accepted; only this Host's own manager label changes the rules.
  for (const role of ["planner", "reviewer", "context_collector", "evidence_runner", "full_tester", "a-role-the-provider-never-heard-of"]) {
    const binding = gateBinding(role, buildGateArgs({ cwd: f.root, productWrites: [], auxiliaryWrites: [f.artifacts] }));
    assert.equal(allowed(binding, "bash", { command: "npm test" }, f.root), true, role);
    assert.equal(allowed(binding, "write", { file_path: join(f.artifacts, "x.md") }, f.root), true, role);
  }
  // A non-coding role cannot be handed product grants at all.
  assert.throws(() => gateBinding("reviewer", buildGateArgs({ cwd: f.lane, lane: f.lane, productWrites: [join(f.lane, "src", "a.ts")] })),
    /may not own product writes/);
  assert.throws(() => gateBinding("coding_worker", buildGateArgs({ cwd: f.lane, lane: "relative", productWrites: [] })), /absolute lane/);
  assert.throws(() => gateBinding("coding_worker", buildGateArgs({ cwd: f.lane, lane: f.lane, productWrites: [join(f.other, "src", "d.ts")] })),
    /outside the assignment lane/);
});

test("the scheduling entry points are refused for every registered Session", t => {
  const f = fixture(t);
  for (const binding of [coding(f), gateBinding("manager", buildGateArgs({ cwd: f.root, productWrites: [], auxiliaryWrites: [f.artifacts] }))]) {
    for (const name of ["subagent", "subagent_fork", "workflow", "ralph", "spawn_teammate", "wait_agent",
      "team_task_create", "team_task_list", "team_task_get", "team_task_update", "send_message", "interrupt_agent", "codex_workers",
      "spawn_agent", "Agent", "resume_agent", "close_agent"]) {
      assert.match(denial(binding, name, {}, f.root), /Host's lifecycle decision/);
    }
    // Read-only queries about the same agents stay available.
    for (const name of ["list_agents", "list_subagent_models", "job_list"]) assert.equal(allowed(binding, name, {}, f.root), true, name);
  }
});

test("the path helpers use real containment, not string prefixes", () => {
  const grant = { path: "/work/lane-01", kind: "directory" };
  assert.equal(within(grant, "/work/lane-01"), true);
  assert.equal(within(grant, "/work/lane-01/src/a.ts"), true);
  assert.equal(within(grant, "/work/lane-010/src/a.ts"), false);
  assert.equal(within(grant, "/work/lane-01/../lane-02/a.ts"), false);
  assert.equal(within({ path: "/work/a.ts", kind: "file" }, "/work/a.ts"), true);
  assert.equal(within({ path: "/work/a.ts", kind: "file" }, "/work/a.ts/b"), false);
});

test("patch extraction reads directives only, never diff content", () => {
  const patch = [
    "*** Begin Patch",
    "*** Update File: /w/a.txt",
    "@@",
    "+*** Add File: /w/not-a-directive.txt",
    "*** Move to: /w/b.txt",
    "*** End Patch",
  ].join("\n");
  assert.deepEqual(patchTargets(patch), { paths: ["/w/a.txt", "/w/b.txt"] });
  assert.deepEqual(patchTargets("*** Begin Patch\n*** End Patch"), { error: "apply_patch names no file operation" });
  assert.equal("error" in patchTargets(""), true);
});

test("write-target extraction is total for the known tools", t => {
  const f = fixture(t);
  assert.deepEqual(writeTargets("write", { file_path: "/w/a" }), { paths: ["/w/a"] });
  assert.deepEqual(writeTargets("str_replace_editor", { command: "view" }), { read: true });
  assert.deepEqual(writeTargets("bash", { command: "rm -rf /" }), { read: true });
  assert.throws(() => pathGrant("relative/path"), /must be absolute/);
  assert.equal(pathGrant(f.lane).kind, "directory");
  assert.equal(pathGrant(join(f.lane, "src", "a.ts")).kind, "file");
  assert.equal(pathGrant(join(f.lane, "src", "missing.ts")).kind, "file");
  assert.equal(resolvedTarget(join(f.source, "escape", "missing.ts")), join(f.outside, "missing.ts"));
});

test("a stored gate is validated, and records without one stay readable", t => {
  const f = fixture(t);
  const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "workflow-gate-store-")));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const state = join(stateDir, "orchestration.json");
  const record = (gate) => ({ id: "child", parentSessionId: "parent", name: "n", role: "coding_worker", profile: "a",
    execution: { provider: "codex", model: "m", reasoningEffort: "high", developerInstructions: "i" },
    boundary: { cwd: f.lane, writableRoots: [f.lane], network: "disabled", ports: {} }, dispatches: [], acceptance: {},
    ...(gate === undefined ? {} : { gate }) });
  const write = value => {
    const store = new WorkflowStore(stateDir);
    store.putNativeChild(value);
  };
  rmSync(stateDir, { recursive: true, force: true });
  mkdirSync(stateDir, { recursive: true });
  write(record(undefined));
  assert.equal(new WorkflowStore(stateDir).read().nativeChildren.child.gate, undefined);

  rmSync(stateDir, { recursive: true, force: true });
  mkdirSync(stateDir, { recursive: true });
  const binding = coding(f);
  write(record(JSON.parse(JSON.stringify(binding))));
  assert.deepEqual(new WorkflowStore(stateDir).read().nativeChildren.child.gate, binding);

  for (const bad of [{ role: "", hook: WORKFLOW_GATE_HOOK, args: binding.args },
    { role: "coding_worker", hook: "", args: binding.args },
    { role: "coding_worker", hook: WORKFLOW_GATE_HOOK, args: { cwd: "relative" } },
    { role: "coding_worker", hook: WORKFLOW_GATE_HOOK, args: null },
    { role: "coding_worker", hook: WORKFLOW_GATE_HOOK }]) {
    rmSync(stateDir, { recursive: true, force: true });
    mkdirSync(stateDir, { recursive: true });
    write(record(bad));
    assert.throws(() => new WorkflowStore(stateDir), /Invalid native child gate binding/, JSON.stringify(bad));
  }
  assert.equal(readGateArgs(binding.args).cwd, f.lane);
  assert.equal(readGateArgs({ cwd: "relative" }), undefined);
  assert.equal(readGateArgs({ cwd: f.lane, productWrites: [{ path: f.lane, kind: "symlink" }], auxiliaryWrites: [], sharedWrites: [] }), undefined);
});
