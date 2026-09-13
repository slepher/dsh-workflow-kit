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
    assert.equal(f.calls[0].options.execution.developerInstructions, "Reviewer instructions");
    f.finish("child-a");
    await f.workers.append("parent", "child-a", "continue A", true, "a-next");
    assert.equal(f.facts.get("child-a").model, "model-a");
    assert.equal(f.calls[2].delivery, "queue");
    assert.equal(f.store.read().nativeChildren["child-a"].profile, "a");
    assert.equal(f.store.read().nativeChildren["child-b"].profile, "b");
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
