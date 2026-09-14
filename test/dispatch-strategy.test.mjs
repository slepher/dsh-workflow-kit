import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "./native-fixture.mjs";
import { Workflow } from "../lib/index.js";

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

/** Two distinct coding configurations plus one reviewer row. */
const DISTINCT = {
  reviewer: { provider: "codex", model: "review-model", reasoningEffort: "high" },
  def_coding_worker: { provider: "codex", model: "def-model", reasoningEffort: "medium" },
  sup_coding_worker: { provider: "codex", model: "sup-model", reasoningEffort: "high" },
};

/** One provider and model for both coding configurations. */
const SHARED = {
  reviewer: { provider: "codex", model: "review-model", reasoningEffort: "high" },
  def_coding_worker: { provider: "codex", model: "same-model", reasoningEffort: "medium" },
  sup_coding_worker: { provider: "codex", model: "same-model", reasoningEffort: "ultra" },
};

/** One repository, generation and implementation contract with the given Role. */
function project(t, role = "coding_worker") {
  const root = mkdtempSync(join(tmpdir(), "workflow-strategy-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo"); mkdirSync(repo);
  git(repo, "init", "-b", "main"); git(repo, "config", "user.email", "test@example.invalid"); git(repo, "config", "user.name", "Test");
  writeFileSync(join(repo, "a.txt"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD"), generation = join(repo, "agentwork", "fixture", "generation-1");
  mkdirSync(join(generation, "tasks"), { recursive: true });
  writeFileSync(join(generation, "plan.md"), `- Schema: 1\n- Revision: 1\n- Repository: ${repo}\n- Target: refs/heads/main\n- Base: ${base}\n- Delivery: target-merge\n## Goal\nFixture\n## Acceptance\nFinish.\n## Lane policy\n- Initial lanes: 1\n- Max lanes: 1\n- Expand: no\n- Bases: ["plan", "target"]\n- Isolation: worktree\n- Merge method: merge\n`);
  writeFileSync(join(generation, "tasks.md"), "## T001\n- State: executable\n- Revision: 1\n## T002\n- State: executable\n- Revision: 1\n## T003\n- State: executable\n- Revision: 1\n");
  writeFileSync(join(generation, "tasks", "T001.md"), `- Revision: 1\n- Kind: implementation\n- Role: ${role}\n- Depends on: []\n- Owned paths: ["a.txt"]\n- Resources: []\n- Inputs: ["${base}"]\n- Review: independent\n## Goal\nChange file.\n## Acceptance\nTarget receives change.\n## Constraints\nOwn a.txt.\n## Validation\nRead file.\n## Return when\nDone.\n`);
  // Two further no-code tasks let a test dispatch under another configuration
  // without owning the lane the first attempt occupies.
  for (const id of ["T002", "T003"]) writeFileSync(join(generation, "tasks", `${id}.md`), `- Revision: 1\n- Kind: implementation\n- Role: coding_worker\n- Depends on: []\n- Owned paths: []\n- Resources: []\n- Inputs: ["${base}"]\n- Review: manager\n- Lane: no\n- Cwd: .\n- Read paths: ["."]\n## Goal\nReport.\n## Acceptance\nEvidence returned.\n## Constraints\nNo writes.\n## Validation\nCheck.\n## Return when\nDone.\n`);
  return { repo, generation };
}

/** Adopt and dispatch one generation, returning the fixture and its workflow. */
async function dispatched(t, roles) {
  const { repo, generation } = project(t);
  const f = fixture(t, { cwd: repo, roles });
  const workflow = new Workflow(f.workers, "/skills/codex-workflow");
  await f.run(() => workflow.execute("parent", { action: "adopt", generation }));
  return { f, workflow, dispatch: () => f.run(() => workflow.execute("parent", { action: "dispatch", task: "T001" })) };
}

test("the default coding strategy dispatches the unified role on the def configuration", async t => {
  const { f, dispatch } = await dispatched(t, DISTINCT);
  await dispatch();
  const created = f.calls.find(call => call.options !== undefined);
  assert.equal(created.options.model, "def-model", "adaptive starts on def");
  assert.match(created.prompt[0].text, /Bound execution strategy: adaptive \(requested adaptive\); phase main; model configuration tier def/);
  const attempt = f.store.read().runs[0].attempts[0];
  assert.equal(attempt.strategy, "adaptive");
  assert.equal(attempt.effectiveStrategy, "adaptive");
  assert.equal(attempt.tier, "def");
  assert.deepEqual(Object.keys(attempt.coding).sort(), ["def", "sup"]);
  assert.equal(attempt.coding.def.model, "def-model", "the Profile snapshot is captured at dispatch");
});

test("a Session strategy override changes the configuration a dispatch binds", async t => {
  const { f, dispatch } = await dispatched(t, DISTINCT);
  f.store.selectStrategy("parent", "expert");
  await dispatch();
  const created = f.calls.find(call => call.options !== undefined);
  assert.equal(created.options.model, "sup-model", "expert runs the sup configuration");
  assert.match(created.prompt[0].text, /Bound execution strategy: independent \(requested expert\)/);
  const worker = (await f.run(() => f.workers.list("parent")))[0];
  assert.deepEqual(worker.strategy, { requested: "expert", effective: "independent", tier: "sup", phase: "main" });
});

test("an integrate selection never leaks into coding dispatch", async t => {
  const { f, dispatch } = await dispatched(t, DISTINCT);
  f.configuration.setUserStrategies({ codingStrategy: "adaptive", integrateStrategy: "expert" });
  await dispatch();
  assert.equal(f.calls.find(call => call.options !== undefined).options.model, "def-model", "the coding preference, not the integrate default, decides");
});

test("a same-model configuration fixes independent def execution whatever the preference says", async t => {
  const { f, dispatch } = await dispatched(t, SHARED);
  f.store.selectStrategy("parent", "bootstrap");
  await dispatch();
  const created = f.calls.find(call => call.options !== undefined);
  assert.equal(created.options.model, "same-model");
  assert.equal(created.options.reasoningEffort, "medium", "the derived execution uses def's effort");
  assert.match(created.prompt[0].text, /Bound execution strategy: independent \(requested bootstrap\); phase main; model configuration tier def/);
  const worker = (await f.run(() => f.workers.list("parent")))[0];
  assert.equal(worker.strategy.tier, "def", "no handoff tier is bound");
  assert.equal(f.store.strategyPreference("parent"), "bootstrap", "the preference is retained for a later Profile switch");
});

test("switching to a same-model configuration and back restores the stored preference", async t => {
  // The fixture ships two configurations: `a` carries the distinct models and
  // `b` rewrites every row to one shared model.
  const { repo, generation } = project(t);
  const f = fixture(t, { cwd: repo, roles: DISTINCT });
  const workflow = new Workflow(f.workers, "/skills/codex-workflow");
  const action = input => f.run(() => workflow.execute("parent", input));
  await action({ action: "adopt", generation });
  f.store.selectStrategy("parent", "expert");
  await action({ action: "dispatch", task: "T001" });
  assert.equal(f.calls.find(call => call.options !== undefined).options.model, "sup-model", "distinct models honor the preference");

  // The shared-model configuration fixes independent def execution without
  // discarding the preference.
  f.store.selectProfile("parent", "b");
  const second = await dispatchedOn(f, workflow, "T002");
  assert.equal(second.model, "model-b", "the shared-model configuration runs one model");
  assert.equal(second.effort, "medium", "the derived execution uses def's effort");
  assert.equal(f.store.strategyPreference("parent"), "expert", "the preference survives the same-model period");

  // Returning to a configuration with distinct models restores it.
  f.store.selectProfile("parent", "a");
  const third = await dispatchedOn(f, workflow, "T003");
  assert.equal(third.model, "sup-model", "the stored preference takes effect again");
});

/** Dispatch one more task from the same generation and return its created capture. */
async function dispatchedOn(f, workflow, task) {
  const before = f.calls.filter(call => call.options !== undefined).length;
  await f.run(() => workflow.execute("parent", { action: "dispatch", task }));
  const created = f.calls.filter(call => call.options !== undefined)[before];
  return { model: created.options.model, effort: created.options.reasoningEffort, prompt: created.prompt[0].text };
}

test("a legacy coding contract is refused until it is revised to the unified role", async t => {
  const { repo, generation } = project(t, "def_coding_worker");
  const f = fixture(t, { cwd: repo, roles: DISTINCT });
  const workflow = new Workflow(f.workers, "/skills/codex-workflow");
  await f.run(() => workflow.execute("parent", { action: "adopt", generation }));
  await assert.rejects(f.run(() => workflow.execute("parent", { action: "dispatch", task: "T001" })),
    /Legacy coding role def_coding_worker must be revised to Role: coding_worker/);
  assert.equal(f.calls.length, 0, "no child was created");
});

/** Take one implementation attempt through candidate recording and independent review. */
async function acceptedCandidate(t, roles) {
  const { repo, generation } = project(t);
  const f = fixture(t, { cwd: repo, roles });
  const workflow = new Workflow(f.workers, "/skills/codex-workflow");
  const action = input => f.run(() => workflow.execute("parent", input));
  const base = git(repo, "rev-parse", "HEAD");
  await action({ action: "adopt", generation });
  await action({ action: "dispatch", task: "T001" });
  let summary = await action({ action: "status" });
  const attempt = summary.tasks[0], lane = summary.lanes.find(item => item.name === attempt.lane);
  writeFileSync(join(lane.path, "a.txt"), "candidate\n"); git(lane.path, "add", "a.txt"); git(lane.path, "commit", "-m", "candidate");
  const candidate = git(lane.path, "rev-parse", "HEAD");
  await f.run(async () => { f.finish(attempt.workerId, `- Task: T001\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${candidate}\n- Outcome: complete\n`); });
  await action({ action: "record-result", task: "T001" });
  const review = (await action({ action: "status" })).tasks.find(item => item.task === "T001").review;
  await f.run(async () => { f.finish(review.worker, JSON.stringify({ candidate, input: base, verdict: "passed", findings: "Verified" })); });
  await action({ action: "accept", task: "T001" });
  // Advance the target so the integration overlaps the candidate and needs review.
  writeFileSync(join(repo, "a.txt"), "target\n"); git(repo, "add", "a.txt"); git(repo, "commit", "-m", "target");
  return { f, workflow, action, base, candidate };
}

test("an integration binds the integrate strategy for its review, not the coding strategy", async t => {
  for (const [integrate, expected] of [["economy", "def-model"], ["expert", "sup-model"]]) {
    const { f, action } = await acceptedCandidate(t, DISTINCT);
    f.store.selectStrategy("parent", "expert"); // a Session coding override that must not reach integration
    f.configuration.setUserStrategies({ codingStrategy: "expert", integrateStrategy: integrate });
    await action({ action: "integrate", task: "T001" });
    const summary = await action({ action: "status" });
    const integration = summary.tasks.find(item => item.task === "T001").integration;
    assert.equal(integration.strategy, "independent", "economy and expert both run independently");
    const stored = f.store.read().runs[0].attempts[0].integration;
    assert.equal(stored.tier, integrate === "economy" ? "def" : "sup", `integrate ${integrate} binds its own tier`);
    assert.equal(stored.coding.def.model, "def-model", "the integration keeps its own Profile snapshot");
    assert.equal(stored.profile, "a", "the integration records the Profile it was prepared with");
    const created = f.calls.find(call => call.id === integration.reviewer);
    assert.equal(created.options.model, expected, `integrate ${integrate} selects its own configuration`);
    assert.equal(created.options.execution.developerInstructions, "Reviewer instructions [integrate-execution]",
      "the reviewer keeps its own responsibility and gains only the integrate phase text");
  }
});
