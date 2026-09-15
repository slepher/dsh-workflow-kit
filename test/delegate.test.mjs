import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "./native-fixture.mjs";
import { ROLES, Workflow } from "../lib/index.js";

/**
 * Delegation is the other half of the workflow contract: one bounded task goes
 * to one role without adopting a generation. The role's protocol is this
 * plugin's content, so it travels as the child's opening prompt, and the child's
 * permissions are only what the caller declared.
 */
test("delegate assigns one role task without a generation and keeps its handle", async t => {
  const root = mkdtempSync(join(tmpdir(), "workflow-delegate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, "work"); mkdirSync(cwd);
  const f = fixture(t, { cwd, roles: Object.fromEntries(ROLES.map(role => [role.name, { provider: role.provider, model: role.model, reasoningEffort: role.effort }])) });
  const workflow = new Workflow(f.workers, "/skills/codex-workflow");
  const action = input => f.run(() => workflow.execute("parent", input));

  // No generation is adopted: the catalogue and delegation both answer directly.
  const started = await action({ action: "delegate", role: "evidence_runner", text: "Run the acceptance check." });
  assert.equal(typeof started.worker.id, "string");
  assert.equal(started.worker.role, "evidence_runner");
  assert.equal(f.calls.length, 1, "one delegation starts one native child");
  const opening = f.promptText(f.calls[0]);
  assert.match(opening, /Execute evidence_runner/, "the role's protocol is the child's opening prompt");
  assert.match(opening, /Run the acceptance check\./, "and the assignment follows it");
  assert.equal(f.calls[0].options.model, ROLES.find(role => role.name === "evidence_runner").model,
    "the child runs the role's configured model");
  assert.deepEqual(f.calls[0].options.execution.boundary, { cwd, writableRoots: [], network: "disabled" },
    "an undeclared delegation is read-only in the parent's workspace");

  // A second task while the child runs steers the active turn, not a new child.
  await action({ action: "delegate", worker: started.worker.id, text: "Also record the exit status." });
  assert.equal(f.calls.length, 2, "a running delegation is steered rather than restarted");
  assert.equal(f.calls[1].id, started.worker.id);
  assert.equal(f.calls[1].delivery, "steer");

  // Reading the handle reports the child's state and its latest report.
  const idle = await f.run(async () => {
    f.finish(started.worker.id, "- Outcome: complete");
    return workflow.execute("parent", { action: "delegate", worker: started.worker.id });
  });
  assert.equal(idle.worker.state, "idle");
  assert.equal(idle.report.result, "- Outcome: complete");

  // Stopping targets the running turn, and an idle child is left alone.
  await action({ action: "delegate", worker: started.worker.id, stop: true });
  assert.equal(f.calls.some(call => call.interrupt === true), false, "an idle child is not interrupted");
  await f.run(async () => { f.facts.get(started.worker.id).state = "running"; });
  await action({ action: "delegate", worker: started.worker.id, stop: true });
  assert.equal(f.calls.some(call => call.interrupt === true), true, "a running delegation can be stopped");
});

test("delegate refuses what it cannot execute as asked", async t => {
  const root = mkdtempSync(join(tmpdir(), "workflow-delegate-guards-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, "work"); mkdirSync(cwd);
  const f = fixture(t, { cwd, roles: Object.fromEntries(ROLES.map(role => [role.name, { provider: role.provider, model: role.model, reasoningEffort: role.effort }])) });
  const workflow = new Workflow(f.workers, "/skills/codex-workflow");
  const action = input => f.run(() => workflow.execute("parent", input));

  await assert.rejects(action({ action: "delegate", text: "no role" }), /requires the role/);
  // The message names the field to pass; `task` belongs to adopted generations.
  await assert.rejects(action({ action: "delegate", role: "evidence_runner" }), /requires `text`.*not used here/s);
  await assert.rejects(action({ action: "delegate", role: "evidence_runner", task: "t1" }), /requires `text`/,
    "a task id is not the prompt: the caller is told which field starts the child");
  await assert.rejects(action({ action: "delegate", role: "no_such_role", text: "x" }), /lacks required roles: no_such_role|Unknown DSH role/);
  await assert.rejects(action({ action: "delegate", role: "evidence_runner", text: "x", cwd: "relative/dir" }), /absolute directory/);
  await assert.rejects(action({ action: "delegate", role: "coding_worker", text: "x", writes: ["src"] }), /absolute paths/);

  // A declared write scope is exactly what the child receives.
  const writing = await action({ action: "delegate", role: "coding_worker", text: "Patch the file.", writes: [cwd], network: "loopback" });
  assert.deepEqual(f.calls.at(-1).options.execution.boundary, { cwd, writableRoots: [cwd], network: "loopback" });
  assert.equal(writing.worker.id.length > 0, true);
});
