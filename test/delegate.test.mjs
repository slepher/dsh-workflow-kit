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
  assert.equal(typeof started.child.id, "string");
  assert.equal(started.child.role, "evidence_runner");
  assert.equal(f.calls.length, 1, "one delegation starts one native child");
  const opening = f.promptText(f.calls[0]);
  assert.match(opening, /Execute evidence_runner/, "the role's protocol is the child's opening prompt");
  assert.match(opening, /Run the acceptance check\./, "and the assignment follows it");
  assert.equal(f.calls[0].options.model, ROLES.find(role => role.name === "evidence_runner").model,
    "the child runs the role's configured model");
  assert.deepEqual(f.calls[0].options.execution.boundary, { cwd, writableRoots: [], network: "disabled" },
    "an undeclared delegation is read-only in the parent's workspace");

  // A second task while the child runs steers the active turn, not a new child.
  await action({ action: "delegate", child: started.child.id, text: "Also record the exit status." });
  assert.equal(f.calls.length, 2, "a running delegation is steered rather than restarted");
  assert.equal(f.calls[1].id, started.child.id);
  assert.equal(f.calls[1].delivery, "steer");

  // Reading the handle reports the child's state and its latest report.
  const idle = await f.run(async () => {
    f.finish(started.child.id, "- Outcome: complete");
    return workflow.execute("parent", { action: "delegate", child: started.child.id });
  });
  assert.equal(idle.child.state, "idle");
  assert.equal(idle.report.result, "- Outcome: complete");

  // Stopping targets the running turn, and an idle child is left alone.
  await action({ action: "delegate", child: started.child.id, stop: true });
  assert.equal(f.calls.some(call => call.interrupt === true), false, "an idle child is not interrupted");
  await f.run(async () => { f.facts.get(started.child.id).state = "running"; });
  await action({ action: "delegate", child: started.child.id, stop: true });
  assert.equal(f.calls.some(call => call.interrupt === true), true, "a running delegation can be stopped");
});

test("a delegation states its reply, or why there is none", async t => {
  const root = mkdtempSync(join(tmpdir(), "workflow-delegate-reply-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, "work"); mkdirSync(cwd);
  const f = fixture(t, { cwd, roles: Object.fromEntries(ROLES.map(role => [role.name, { provider: role.provider, model: role.model, reasoningEffort: role.effort }])) });
  const workflow = new Workflow(f.workers, "/skills/codex-workflow");
  const action = input => f.run(() => workflow.execute("parent", input));

  // The start answers before the child worked, so the result names the channel
  // the reply will arrive on instead of leaving the caller to guess.
  const started = await action({ action: "delegate", role: "evidence_runner", text: "Run the acceptance check." });
  assert.equal(started.reply, null);
  assert.equal(started.report, null);
  assert.match(started.note, /settlement notice/, "a pending reply says where it will arrive");

  // A settled child's report text is its reply.
  const reported = await f.run(async () => {
    f.finish(started.child.id, "- Outcome: complete");
    return action({ action: "delegate", child: started.child.id });
  });
  assert.equal(reported.reply, "- Outcome: complete");
  assert.equal(reported.note, undefined, "a reply needs no explanation");

  // An empty report is a result too: the caller is told the turn reported
  // nothing rather than being handed a null it cannot read.
  const blank = await action({ action: "delegate", role: "evidence_runner", text: "Run the blank check." });
  const empty = await f.run(async () => {
    f.finish(blank.child.id, "   ");
    return action({ action: "delegate", child: blank.child.id });
  });
  assert.equal(empty.reply, null);
  assert.notEqual(empty.report, null, "the empty report stays the evidence for the missing reply");
  assert.match(empty.note, /reported no result/);

  // Settling with no report at all reads differently from still running.
  const silent = await action({ action: "delegate", role: "evidence_runner", text: "Run the silent check." });
  f.facts.get(silent.child.id).state = "idle";
  f.ctx.agents.delete(silent.child.id); f.ctx.sessions.delete(silent.child.id);
  const settled = await action({ action: "delegate", child: silent.child.id });
  assert.equal(settled.reply, null);
  assert.match(settled.note, /settled without reporting/);
  assert.notEqual(settled.note, started.note, "a finished child is not reported as a pending one");
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
  assert.equal(writing.child.id.length > 0, true);
});
