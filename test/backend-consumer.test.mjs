import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { WorkflowStore, WorkflowWorkers } from "../lib/index.js";
import { fixture } from "./native-fixture.mjs";

test("Workflow reads native execution facts and persists only workflow ownership and acceptance", async t => {
  const f = fixture(t);
  let checks = 0;
  const get = f.ctx.agents.get.bind(f.ctx.agents);
  f.ctx.agents.get = id => { checks++; return get(id); };
  await f.run(async () => {
    await f.create("managed");
    const running = await f.workers.append("parent", "managed", "inspect", true);
    f.finish("managed", "exact final reply");
    const report = await f.workers.report("parent", "managed", running.turnId);
    assert.equal(report.result, "exact final reply");
    await assert.rejects(f.workers.accept("parent", "managed", running.turnId, "accepted"), /requires codex_workflow/);
    assert.equal((await f.workers.accept("parent", "managed", running.turnId, "accepted", true)).acceptance, "accepted");
  });
  assert.ok(checks > 1, "identity is rechecked across native awaits");
  const saved = JSON.parse(readFileSync(join(f.store.stateDir, "orchestration.json"), "utf8"));
  assert.equal("reports" in saved.nativeChildren.managed, false);
  assert.equal("state" in saved.nativeChildren.managed, false, "execution state is read from the provider");
  assert.equal("acceptance" in f.facts.get("managed").reports[0], false, "provider facts do not own workflow acceptance");
  const reopened = new WorkflowWorkers(f.ctx, new WorkflowStore(f.store.stateDir), f.configuration, "b");
  await reopened.run(f.parent, new AbortController().signal, async () => {
    const worker = await reopened.get("parent", "managed");
    assert.equal(worker.profile, "a"); assert.equal(worker.reports[0].acceptance, "accepted");
  });
});

test("native workflow creation preserves arbitrary legacy worker data", async t => {
  const f = fixture(t), file = join(f.store.stateDir, "workflow.json"), legacy = '{"workers":[{"id":"old"}]}\n';
  writeFileSync(file, legacy);
  await f.run(() => f.create("new"));
  assert.equal(readFileSync(file, "utf8"), legacy);
  assert.equal("workers" in f.store.read(), false);
  assert.equal(f.store.read().nativeChildren.new.parentSessionId, "parent");
});
