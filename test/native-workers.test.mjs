import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./native-fixture.mjs";

test("native creation snapshots profiles; continuation preserves A after switching to B", async t => {
  const f = fixture(t);
  await f.run(async () => {
    await f.create("child-a");
    f.store.selectProfile("parent", "b");
    await f.create("child-b");
    await f.workers.append("parent", "child-a", "task A", true, "a-first");
    await f.workers.append("parent", "child-b", "task B", true, "b-first");
    assert.equal(f.calls[0].options.model, "model-a");
    assert.equal(f.calls[1].options.model, "model-b");
    assert.match(f.promptText(f.calls[0]), /Reviewer instructions/, "the role instructions open the child's own conversation");
    f.finish("child-a");
    await f.workers.append("parent", "child-a", "continue A", true, "a-next");
    assert.equal(f.facts.get("child-a").model, "model-a");
    assert.equal(f.calls[2].delivery, "queue");
    assert.equal(f.store.read().nativeChildren["child-a"].profile, "a");
    assert.equal(f.store.read().nativeChildren["child-b"].profile, "b");
  });
});

test("a lane worker reconciles on its execution cwd, and a drifted native cwd is unknown", async t => {
  const f = fixture(t);
  const host = f.parent.session.header.cwd;
  const lane = `${host}/lane`;
  await f.run(async () => {
    const snapshot = f.workers.captureRole("reviewer");
    // The task's assigned workspace is the lane. The workflow records the
    // execution cwd; the DSH Session's host workspace is the parent's and never
    // enters this record, so a lane worker reconciles instead of turning unknown.
    await f.workers.create(f.parent.id, { id: "lane-child", name: "lane child", cwd: lane, ...snapshot, managed: true,
      boundary: { cwd: lane, writableRoots: [lane], network: "disabled", ports: {} } });
    await f.workers.append(f.parent.id, "lane-child", "task", true);
    assert.equal(f.facts.get("lane-child").cwd, lane, "the native execution runs in the lane");
    assert.equal(f.calls[0].options.execution.boundary.cwd, lane, "the declared boundary travels verbatim");
    f.finish("lane-child");
    const settled = await f.workers.get(f.parent.id, "lane-child");
    assert.equal(settled.state, "idle", "a lane worker is reconciled, never unknown");
    assert.equal(settled.cwd, lane, "the projection reports the execution cwd");
    assert.equal(settled.reports.length, 1);
    assert.equal(settled.reports[0].result, "deliverable");

    // A native thread that reports the host workspace instead of the lane is a
    // real inconsistency and must stay observable.
    f.facts.get("lane-child").cwd = host;
    assert.equal((await f.workers.get(f.parent.id, "lane-child")).state, "unknown");
  });
});

test("lost native acceptance response is observed without resending; unknown cannot be closed or accepted", async t => {
  const f = fixture(t);
  await f.run(async () => {
    await f.create("child");
    const start = f.ctx.subagents.startContinuable;
    f.ctx.subagents.startContinuable = async spec => { await start(spec); throw new Error("lost acceptance response"); };
    await assert.rejects(f.workers.append("parent", "child", "task", true, "first"), /lost acceptance/);
    await f.workers.append("parent", "child", "task", true, "first");
    assert.equal(f.calls.length, 1);
    await assert.rejects(f.workers.append("parent", "child", "different", true, "first"), /Idempotency/);
    f.facts.get("child").state = "unknown"; f.ctx.agents.delete("child");
    assert.equal((await f.workers.get("parent", "child")).state, "unknown");
    await assert.rejects(f.workers.append("parent", "child", "retry", true), /unknown/);
    await assert.rejects(f.workers.closeWorker("parent", "child", true, true), /terminal execution/);
    await assert.rejects(f.workers.accept("parent", "child", "child:1", "accepted", true), /confirmed idle/);
    assert.equal(f.calls.length, 1);
  });
});

test("acceptance and acknowledgement reuse old semantics in workflow storage, and parent identity remains live", async t => {
  const f = fixture(t);
  await f.run(async () => {
    await f.create("child");
    await f.workers.append("parent", "child", "task", true);
    f.finish("child");
    const report = await f.workers.accept("parent", "child", "child:1", "accepted", true);
    assert.equal(report.acceptance, "accepted"); assert.ok(report.acknowledgedAt);
    assert.equal((await f.workers.acknowledge("parent", "child", "child:1")).acknowledgedAt, report.acknowledgedAt);
    assert.equal("acceptance" in f.facts.get("child").reports[0], false);
    await f.workers.closeWorker("parent", "child", false, true);
    await assert.rejects(f.workers.append("parent", "child", "new", true), /closed/);
    assert.ok(f.facts.has("child"), "closing workflow bookkeeping retains native execution history");
    f.ctx.agents.set("parent", { ...f.parent });
    assert.throws(() => f.workers.assertIdentity(), /identity changed/);
  });
});
