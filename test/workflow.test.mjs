import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "./native-fixture.mjs";
import { ROLES, Workflow, WorkflowStore, WorkflowWorkers } from "../lib/index.js";

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

test("managed no-lane attempt enforces result, acceptance, delivery, and release", async t => {
  const root = mkdtempSync(join(tmpdir(), "workflow-managed-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo"); mkdirSync(repo); git(repo, "init", "-b", "main"); git(repo, "config", "user.email", "test@example.invalid"); git(repo, "config", "user.name", "Test");
  writeFileSync(join(repo, "a.txt"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD"), generation = join(repo, "agentwork", "fixture", "generation-1"); mkdirSync(join(generation, "tasks"), { recursive: true });
  writeFileSync(join(generation, "plan.md"), `- Schema: 1\n- Revision: 1\n- Repository: ${repo}\n- Target: refs/heads/main\n- Base: ${base}\n- Delivery: target-merge\n## Goal\nFixture\n## Acceptance\nFinish.\n## Lane policy\n- Initial lanes: 1\n- Max lanes: 1\n- Expand: no\n- Bases: ["plan", "target"]\n- Isolation: worktree\n- Merge method: merge\n`);
  writeFileSync(join(generation, "tasks.md"), ["T001", "T002", "T003", "T004", "T005", "T006", "T007"].map(id => `## ${id}\n- State: executable\n- Revision: 1\n`).join(""));
  writeFileSync(join(generation, "tasks", "T001.md"), `- Revision: 1\n- Kind: investigation\n- Role: evidence_runner\n- Depends on: []\n- Owned paths: []\n- Resources: []\n- Inputs: ["${base}"]\n- Review: manager\n- Lane: no\n- Cwd: .\n- Read paths: ["."]\n## Goal\nInspect.\n## Acceptance\nReturn evidence.\n## Constraints\nRead only.\n## Validation\nCheck fixture.\n## Return when\nDone.\n`);
  writeFileSync(join(generation, "tasks", "T002.md"), `- Revision: 1\n- Kind: implementation\n- Role: coding_worker\n- Depends on: []\n- Owned paths: ["a.txt"]\n- Resources: []\n- Inputs: ["${base}"]\n- Review: independent\n## Goal\nChange file.\n## Acceptance\nTarget receives change.\n## Constraints\nOwn a.txt.\n## Validation\nRead file.\n## Return when\nDone.\n`);
  for (const id of ["T003", "T004", "T005", "T006", "T007"]) writeFileSync(join(generation, "tasks", `${id}.md`), `- Revision: 1\n- Kind: investigation\n- Role: evidence_runner\n- Depends on: []\n- Owned paths: []\n- Resources: []\n- Inputs: ["${base}"]\n- Review: manager\n- Lane: no\n- Cwd: .\n- Read paths: ["."]\n## Goal\nRecover ${id}.\n## Acceptance\nReturn evidence.\n## Constraints\nRead only.\n## Validation\nCheck fixture.\n## Return when\nDone.\n`);
  const f = fixture(t, { cwd: repo, roles: Object.fromEntries(ROLES.map(role => [role.name, { provider: role.provider, model: role.model, reasoningEffort: role.effort }])) });
  const { store, workers } = f, workflow = new Workflow(workers, "/skills/codex-workflow");
  const action = input => f.run(() => workflow.execute("parent", input)).catch(error => { throw new Error(`${input.action} ${input.task ?? ""}: ${error.message}`, { cause: error }); });
  const finish = async (id, turnId, text) => f.run(async () => {
    assert.equal(f.facts.get(id).turnId, turnId); f.finish(id, text);
  });
  await action({ action: "adopt", generation }); await action({ action: "dispatch", task: "T001" });
  let summary = await action({ action: "status" }), attempt = summary.tasks[0];
  assert.match(f.promptText(f.calls[0]), /- Task: T001\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: [0-9a-f]+\n- Candidate snapshot: <actual commit>\n- Outcome: <complete, blocked, needs-decision or needs-verification>/);
  assert.match(f.promptText(f.calls[0]), /Task and command cwd /, "a Codex thread really starts in the assigned directory");
  await assert.rejects(f.run(() => workers.append("parent", attempt.workerId, "unauthorized")), /requires codex_workflow/);
  await finish(attempt.workerId, attempt.turnId, `- Task: T001\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${base}\n- Outcome: complete\n`);
  await action({ action: "record-result", task: "T001" });
  const save = store.save.bind(store); let failAcceptSaves = 2;
  store.save = () => { if (failAcceptSaves > 0) { failAcceptSaves--; throw new Error("injected orchestration save failure"); } save(); };
  await assert.rejects(action({ action: "accept", task: "T001" }), /injected orchestration save failure/);
  summary = await action({ action: "status" }); assert.equal(summary.tasks[0].state, "candidate", "failed W save rolls back only unpersisted attempt state");
  const acceptedReport = await f.run( async () => (await workers.get("parent", attempt.workerId)).reports.find(report => report.turnId === attempt.turnId));
  assert.equal(acceptedReport.acceptance, "accepted", "B acceptance is not rolled back");
  await assert.rejects(action({ action: "integrate", task: "T001" }), /Accept the task candidate/);
  await assert.rejects(action({ action: "accept", task: "T001" }), /injected orchestration save failure/);
  assert.equal((await action({ action: "status" })).tasks[0].state, "candidate", "repeated save failures remain retryable");
  await action({ action: "accept", task: "T001" });
  const retriedReport = await f.run( async () => (await workers.get("parent", attempt.workerId)).reports.find(report => report.turnId === attempt.turnId));
  assert.equal(retriedReport.acknowledgedAt, acceptedReport.acknowledgedAt, "retry reuses the same accepted report");
  assert.equal(new WorkflowStore(f.store.stateDir).read().runs[0].attempts[0].state, "accepted", "retry persists accepted state for restart");
  await action({ action: "integrate", task: "T001" });
  summary = await action({ action: "release", task: "T001", processesStopped: true });
  assert.equal(summary.tasks[0].state, "released");
  assert.equal(f.calls.find(call => f.promptText(call).includes("Execute evidence_runner")).options.model, ROLES.find(role => role.name === "evidence_runner").model);
  await action({ action: "dispatch", task: "T002" }); summary = await action({ action: "status" }); attempt = summary.tasks.find(item => item.task === "T002");
  const lane = summary.lanes.find(item => item.name === attempt.lane); writeFileSync(join(lane.path, "a.txt"), "changed\n"); git(lane.path, "add", "a.txt"); git(lane.path, "commit", "-m", "change"); const candidate = git(lane.path, "rev-parse", "HEAD");
  await finish(attempt.workerId, attempt.turnId, `- Task: T002\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${candidate}\n- Outcome: complete\n`);
  await action({ action: "record-result", task: "T002" }); summary = await action({ action: "status" }); const review = summary.tasks.find(item => item.task === "T002").review;
  await finish(review.worker, review.turn, JSON.stringify({ candidate, input: base, verdict: "passed", findings: "Verified candidate" }));
  await action({ action: "accept", task: "T002" }); await action({ action: "integrate", task: "T002" });
  assert.equal(readFileSync(join(repo, "a.txt"), "utf8"), "changed\n");
  const recoveryBase = git(repo, "rev-parse", "HEAD");
  summary = await action({ action: "release", task: "T002", processesStopped: true }); assert.equal(summary.tasks.find(item => item.task === "T002").state, "released");

  const count = method => f.calls.filter(call => method === "create" ? call.options !== undefined : call.options !== undefined || call.delivery === "queue").length;
  const originalCreate = workers.create.bind(workers), originalAppend = workers.append.bind(workers);
  let lose = true;
  workers.create = async (...args) => { const value = await originalCreate(...args); if (lose) { lose = false; throw new Error("create response lost"); } return value; };
  const createThreads = count("create"), createTurns = count("send");
  await assert.rejects(action({ action: "dispatch", task: "T003", base: recoveryBase }), /create response lost/); workers.create = originalCreate;
  let recovered = (await action({ action: "status" })).tasks.find(item => item.task === "T003"), stable = { workerId: recovered.workerId, lane: recovered.lane };
  const recoverySave = store.save.bind(store); let failRecoverySave = true;
  store.save = () => { if (failRecoverySave) { failRecoverySave = false; throw new Error("injected recovery save failure"); } recoverySave(); };
  await assert.rejects(action({ action: "dispatch", task: "T003", base: recoveryBase }), /injected recovery save failure/);
  recovered = (await action({ action: "status" })).tasks.find(item => item.task === "T003"); assert.equal(recovered.state, "unknown"); assert.equal(recovered.turnId, undefined);
  const afterRecoverySaveFailure = { threads: count("create"), turns: count("send") };
  await action({ action: "dispatch", task: "T003", base: recoveryBase }); recovered = (await action({ action: "status" })).tasks.find(item => item.task === "T003");
  assert.deepEqual({ workerId: recovered.workerId, lane: recovered.lane }, stable); assert.equal(recovered.state, "running"); assert.ok(recovered.turnId);
  assert.equal(count("create"), createThreads + 1); assert.equal(count("send"), createTurns + 1, "confirmed unsent initial turn is appended once");
  assert.deepEqual({ threads: count("create"), turns: count("send") }, afterRecoverySaveFailure, "retry after recovery save failure only records the observed turn");

  lose = true;
  workers.append = async (...args) => { const value = await originalAppend(...args); if (lose) { lose = false; throw new Error("append response lost"); } return value; };
  const appendThreads = count("create"), appendTurns = count("send");
  await assert.rejects(action({ action: "dispatch", task: "T004", base: recoveryBase }), /append response lost/); workers.append = originalAppend;
  recovered = (await action({ action: "status" })).tasks.find(item => item.task === "T004"); stable = { workerId: recovered.workerId, lane: recovered.lane };
  await action({ action: "dispatch", task: "T004", base: recoveryBase }); recovered = (await action({ action: "status" })).tasks.find(item => item.task === "T004");
  assert.deepEqual({ workerId: recovered.workerId, lane: recovered.lane }, stable); assert.equal(recovered.state, "running"); assert.ok(recovered.turnId);
  assert.equal(count("create"), appendThreads + 1); assert.equal(count("send"), appendTurns + 1, "observed running turn is not appended again");

  lose = true;
  workers.append = async (...args) => {
    const value = await originalAppend(...args);
    if (lose) { lose = false; await finish(args[1], value.turnId, `- Task: T005\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${recoveryBase}\n- Candidate snapshot: ${recoveryBase}\n- Outcome: complete\n`); throw new Error("completed append response lost"); }
    return value;
  };
  const completeThreads = count("create"), completeTurns = count("send");
  await assert.rejects(action({ action: "dispatch", task: "T005", base: recoveryBase }), /completed append response lost/); workers.append = originalAppend;
  recovered = (await action({ action: "status" })).tasks.find(item => item.task === "T005"); stable = { workerId: recovered.workerId, lane: recovered.lane };
  await action({ action: "dispatch", task: "T005", base: recoveryBase }); recovered = (await action({ action: "status" })).tasks.find(item => item.task === "T005");
  assert.deepEqual({ workerId: recovered.workerId, lane: recovered.lane }, stable); assert.equal(recovered.state, "unknown"); assert.ok(recovered.turnId);
  assert.equal(count("create"), completeThreads + 1); assert.equal(count("send"), completeTurns + 1, "terminal report prevents append replay");
  await action({ action: "record-result", task: "T005" });

  lose = true;
  workers.create = async (...args) => { const value = await originalCreate(...args); if (lose) { lose = false; throw new Error("create response lost before get failure"); } return value; };
  await assert.rejects(action({ action: "dispatch", task: "T006", base: recoveryBase }), /create response lost before get failure/); workers.create = originalCreate;
  const originalGet = workers.get.bind(workers), beforeGetFailure = (await action({ action: "status" })).tasks.find(item => item.task === "T006"), callsBeforeGetFailure = { threads: count("create"), turns: count("send") };
  workers.get = async () => { throw new Error("injected get failure"); };
  await assert.rejects(action({ action: "dispatch", task: "T006", base: recoveryBase }), /preserved unknown attempt: Error: injected get failure/); workers.get = originalGet;
  const afterGetFailure = (await action({ action: "status" })).tasks.find(item => item.task === "T006");
  assert.deepEqual(afterGetFailure, beforeGetFailure); assert.deepEqual({ threads: count("create"), turns: count("send") }, callsBeforeGetFailure);
  await action({ action: "dispatch", task: "T006", base: recoveryBase });

  lose = true;
  workers.append = async (...args) => { const value = await originalAppend(...args); if (lose) { lose = false; throw new Error("append response lost before mismatch"); } return value; };
  await assert.rejects(action({ action: "dispatch", task: "T007", base: recoveryBase }), /append response lost before mismatch/); workers.append = originalAppend;
  const storedAttempt = store.read().runs[0].attempts.find(item => item.task.id === "T007"); storedAttempt.turn = "wrong-turn"; store.save();
  const mismatchCalls = { threads: count("create"), turns: count("send") };
  await assert.rejects(action({ action: "dispatch", task: "T007", base: recoveryBase }), /turn identity mismatch/);
  assert.equal((await action({ action: "status" })).tasks.find(item => item.task === "T007").turnId, "wrong-turn");
  assert.deepEqual({ threads: count("create"), turns: count("send") }, mismatchCalls);
});

/**
 * Concurrency is a repository-wide budget, so two Sessions may adopt the same
 * repository and both need the count. Reading it per parent made the caller ask
 * for another Session's children, which the parent-identity check refuses.
 */
test("capacity counts every Session that adopted the same repository", async t => {
  const root = mkdtempSync(join(tmpdir(), "workflow-capacity-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo"); mkdirSync(repo); git(repo, "init", "-b", "main"); git(repo, "config", "user.email", "test@example.invalid"); git(repo, "config", "user.name", "Test");
  writeFileSync(join(repo, "a.txt"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD"), generation = join(repo, "agentwork", "fixture", "generation-1"); mkdirSync(join(generation, "tasks"), { recursive: true });
  writeFileSync(join(generation, "plan.md"), `- Schema: 1\n- Revision: 1\n- Repository: ${repo}\n- Target: refs/heads/main\n- Base: ${base}\n- Delivery: target-merge\n## Goal\nFixture\n## Acceptance\nFinish.\n## Lane policy\n- Initial lanes: 1\n- Max lanes: 1\n- Expand: no\n- Bases: ["plan", "target"]\n- Isolation: worktree\n- Merge method: merge\n`);
  writeFileSync(join(generation, "tasks.md"), "## T001\n- State: executable\n- Revision: 1\n## T002\n- State: executable\n- Revision: 1\n");
  for (const id of ["T001", "T002"]) writeFileSync(join(generation, "tasks", `${id}.md`), `- Revision: 1\n- Kind: investigation\n- Role: evidence_runner\n- Depends on: []\n- Owned paths: []\n- Resources: []\n- Inputs: ["${base}"]\n- Review: manager\n- Lane: no\n- Cwd: .\n- Read paths: ["."]\n## Goal\nInspect ${id}.\n## Acceptance\nReturn evidence.\n## Constraints\nRead only.\n## Validation\nCheck fixture.\n## Return when\nDone.\n`);
  const f = fixture(t, { cwd: repo, roles: Object.fromEntries(ROLES.map(role => [role.name, { provider: role.provider, model: role.model, reasoningEffort: role.effort }])) });
  const first = new Workflow(f.workers, "/skills/codex-workflow");
  await f.run(() => first.execute("parent", { action: "adopt", generation }));
  await f.run(() => first.execute("parent", { action: "dispatch", task: "T001" }));
  assert.equal((await f.run(() => first.execute("parent", { action: "status" }))).tasks.length, 1, "one Session starts one attempt");

  // A second Session adopted the same repository; a restart loads both runs.
  const runs = f.store.read().runs;
  const second = structuredClone(runs[0]);
  second.id = "second-run"; second.parent = "parent2"; second.attempts = [];
  runs.push(second); f.store.save();
  const restarted = new Workflow(f.workers, "/skills/codex-workflow");

  // The first Session's next dispatch must count both Sessions' children, not
  // ask the other Session for its own.
  await f.run(() => restarted.execute("parent", { action: "dispatch", task: "T002" }));
  const summary = await f.run(() => restarted.execute("parent", { action: "status" }));
  assert.deepEqual(summary.tasks.map(attempt => attempt.task).sort(), ["T001", "T002"],
    "the same Session keeps dispatching while another owns the repository");
});

/**
 * Completion is a check, not a transition. It reuses the state the release path
 * already guarantees instead of inventing a second "done", it never performs a
 * Git operation, and it still allows a manager to end its turn while a child
 * runs.
 */
test("complete refuses outstanding disposition and accepts delivered, released evidence", async t => {
  const root = mkdtempSync(join(tmpdir(), "workflow-complete-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo"); mkdirSync(repo); git(repo, "init", "-b", "main"); git(repo, "config", "user.email", "test@example.invalid"); git(repo, "config", "user.name", "Test");
  writeFileSync(join(repo, "a.txt"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD"), generation = join(repo, "agentwork", "fixture", "generation-1"); mkdirSync(join(generation, "tasks"), { recursive: true });
  writeFileSync(join(generation, "plan.md"), `- Schema: 1\n- Revision: 1\n- Repository: ${repo}\n- Target: refs/heads/main\n- Base: ${base}\n- Delivery: target-merge\n## Goal\nFixture\n## Acceptance\nFinish.\n## Lane policy\n- Initial lanes: 1\n- Max lanes: 1\n- Expand: no\n- Bases: ["plan", "target"]\n- Isolation: worktree\n- Merge method: merge\n`);
  writeFileSync(join(generation, "tasks.md"), "## T001\n- State: executable\n- Revision: 1\n");
  writeFileSync(join(generation, "tasks", "T001.md"), `- Revision: 1\n- Kind: investigation\n- Role: evidence_runner\n- Depends on: []\n- Owned paths: []\n- Resources: []\n- Inputs: ["${base}"]\n- Review: manager\n- Lane: no\n- Cwd: .\n- Read paths: ["."]\n## Goal\nInspect.\n## Acceptance\nReturn evidence.\n## Constraints\nRead only.\n## Validation\nCheck fixture.\n## Return when\nDone.\n`);
  const f = fixture(t, { cwd: repo, roles: Object.fromEntries(ROLES.map(role => [role.name, { provider: role.provider, model: role.model, reasoningEffort: role.effort }])) });
  const workflow = new Workflow(f.workers, "/skills/codex-workflow");
  const action = input => f.run(() => workflow.execute("parent", input));
  await action({ action: "adopt", generation });

  let summary = await action({ action: "status" });
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.pendingDisposition, [{ task: "T001", state: "undispatched", next: "dispatch" }],
    "status reports the same disposition complete refuses with, and the existing next action");
  await assert.rejects(action({ action: "complete" }), /Workflow is not complete.*"task":"T001".*"next":"dispatch"/);

  await action({ action: "dispatch", task: "T001" });
  summary = await action({ action: "status" });
  assert.equal(summary.complete, false);
  assert.equal(summary.pendingDisposition.some(entry => entry.task === "T001" && entry.state === "running"), true,
    "a running child is outstanding disposition, and the manager may still end its turn");
  assert.equal(summary.pendingDisposition.some(entry => entry.child !== undefined), true, "its child is still open");
  const attempt = summary.tasks[0];
  // Waiting is not a Stop loop: nothing about the gate continues the manager.
  await f.run(async () => {
    assert.equal(f.facts.get(attempt.workerId).turnId, attempt.turnId);
    f.finish(attempt.workerId, `- Task: T001\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${base}\n- Outcome: complete\n`);
  });
  await action({ action: "record-result", task: "T001" });
  const disposition = async () => (await action({ action: "status" })).pendingDisposition.filter(entry => entry.task === "T001");
  assert.deepEqual(await disposition(), [{ task: "T001", attempt: 1, state: "candidate", next: "accept" }]);
  await action({ action: "accept", task: "T001" });
  assert.deepEqual(await disposition(), [{ task: "T001", attempt: 1, state: "accepted", next: "integrate" }]);
  await action({ action: "integrate", task: "T001" });

  // Delivered but not released: the lane and the child are still this run's.
  summary = await action({ action: "status" });
  assert.equal(summary.complete, false, "delivery alone is not completion");
  assert.deepEqual(await disposition(), [{ task: "T001", attempt: 1, state: "delivered", next: "release" }]);
  await assert.rejects(action({ action: "complete" }), /outstanding disposition/);

  const head = git(repo, "rev-parse", "HEAD");
  await action({ action: "release", task: "T001", processesStopped: true });
  summary = await action({ action: "status" });
  assert.equal(summary.complete, true);
  assert.deepEqual(summary.pendingDisposition, []);
  assert.deepEqual(await action({ action: "complete" }), { complete: true });
  assert.equal(git(repo, "rev-parse", "HEAD"), head, "completion performs no Git operation");

  // Archived evidence is discarded evidence: it cannot stand in for delivery.
  const run = f.store.read().runs[0];
  run.attempts[0].discarded = true;
  f.store.save();
  summary = await action({ action: "status" });
  assert.equal(summary.complete, false, "discarded evidence never satisfies completion");
  assert.equal(summary.pendingDisposition.some(entry => entry.task === "T001"), true);
});

/**
 * A child's tools resolve a relative path against the directory that child
 * actually runs in. A Codex thread is started in the assignment; a DSH-native
 * child keeps its parent's workspace, so the prompt must not claim otherwise.
 */
test("a native child is told the workspace its own tools resolve against", async t => {
  const root = mkdtempSync(join(tmpdir(), "workflow-native-cwd-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo"); mkdirSync(repo); git(repo, "init", "-b", "main"); git(repo, "config", "user.email", "test@example.invalid"); git(repo, "config", "user.name", "Test");
  writeFileSync(join(repo, "a.txt"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD"), generation = join(repo, "agentwork", "fixture", "generation-1"); mkdirSync(join(generation, "tasks"), { recursive: true });
  writeFileSync(join(generation, "plan.md"), `- Schema: 1\n- Revision: 1\n- Repository: ${repo}\n- Target: refs/heads/main\n- Base: ${base}\n- Delivery: target-merge\n## Goal\nFixture\n## Acceptance\nFinish.\n## Lane policy\n- Initial lanes: 1\n- Max lanes: 1\n- Expand: no\n- Bases: ["plan", "target"]\n- Isolation: worktree\n- Merge method: merge\n`);
  writeFileSync(join(generation, "tasks.md"), "## T001\n- State: executable\n- Revision: 1\n");
  writeFileSync(join(generation, "tasks", "T001.md"), `- Revision: 1\n- Kind: implementation\n- Role: coding_worker\n- Depends on: []\n- Owned paths: ["a.txt"]\n- Resources: []\n- Inputs: ["${base}"]\n- Review: manager\n## Goal\nChange file.\n## Acceptance\nChanged.\n## Constraints\nOwn a.txt.\n## Validation\nRead it.\n## Return when\nDone.\n`);
  const native = { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "high" };
  const roles = { ...Object.fromEntries(ROLES.map(role => [role.name, { provider: role.provider, model: role.model, reasoningEffort: role.effort }])),
    def_coding_worker: native, sup_coding_worker: native };
  const f = fixture(t, { cwd: repo, roles });
  const workflow = new Workflow(f.workers, "/skills/codex-workflow");
  const action = input => f.run(() => workflow.execute("parent", input));
  await action({ action: "adopt", generation });
  await action({ action: "dispatch", task: "T001" });
  const summary = await action({ action: "status" });
  const attempt = summary.tasks[0], lane = summary.lanes.find(item => item.name === attempt.lane);
  const prompt = f.promptText(f.calls.find(call => call.id === attempt.workerId));
  assert.match(prompt, /This Session's workspace is /, "a native child is told where its own tools resolve relative paths");
  assert.ok(prompt.includes(repo), "the workspace it names is the one the child really reports");
  assert.ok(prompt.includes(lane.path), "and the assigned directory is still stated");
  // A relative path is not the only thing that resolves against a workspace:
  // a build, a test or a git call acts there too, so the prompt must aim them.
  assert.match(prompt, new RegExp(`run every command — build, test, git — with ${lane.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} as its working directory`),
    "commands are aimed at the assigned directory, not at the repository");
  assert.match(prompt, /pass workdir /, "and the child is told how to aim them");
  assert.match(prompt, /write the assigned files by their absolute paths or relative to that workspace/);
  assert.equal(f.facts.get(attempt.workerId).cwd, lane.path, "the execution itself still runs in the assigned lane");
});

/**
 * The cleanup removed author-format and static-overlap checks only. Everything
 * that binds a result to its attempt, its workspace and its reviewed candidate
 * must still refuse — and the Host, not the Python reader, is what refuses.
 */
test("the preserved Host gates still refuse what the removed plan-time checks used to", async t => {
  const root = mkdtempSync(join(tmpdir(), "workflow-preserved-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo"); mkdirSync(repo); git(repo, "init", "-b", "main"); git(repo, "config", "user.email", "test@example.invalid"); git(repo, "config", "user.name", "Test");
  writeFileSync(join(repo, "a.txt"), "base\n"); writeFileSync(join(repo, "b.txt"), "other\n");
  git(repo, "add", "."); git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD"), generation = join(repo, "agentwork", "fixture", "generation-1"); mkdirSync(join(generation, "tasks"), { recursive: true });
  writeFileSync(join(generation, "plan.md"), `- Schema: 1\n- Revision: 1\n- Repository: ${repo}\n- Target: refs/heads/main\n- Base: ${base}\n- Delivery: target-merge\n## Goal\nFixture\n## Acceptance\nFinish.\n## Lane policy\n- Initial lanes: 1\n- Max lanes: 1\n- Expand: no\n- Bases: ["plan", "target"]\n- Isolation: worktree\n- Merge method: merge\n`);
  writeFileSync(join(generation, "tasks.md"), "## T001\n- State: executable\n- Revision: 1\n## T002\n- State: executable\n- Revision: 1\n");
  // Two independent tasks may now declare the same ownership; the Host still
  // decides whether a second one may actually start.
  for (const id of ["T001", "T002"]) writeFileSync(join(generation, "tasks", `${id}.md`), `- Revision: 1\n- Kind: implementation\n- Role: coding_worker\n- Depends on: []\n- Owned paths: ["a.txt"]\n- Resources: []\n- Inputs: ["${base}"]\n- Review: independent\n## Goal\nChange a.txt.\n## Acceptance\nChanged.\n## Constraints\nOwn a.txt.\n## Validation\nRead it.\n## Return when\nDone.\n`);
  const f = fixture(t, { cwd: repo, roles: Object.fromEntries(ROLES.map(role => [role.name, { provider: role.provider, model: role.model, reasoningEffort: role.effort }])) });
  const workflow = new Workflow(f.workers, "/skills/codex-workflow");
  const action = input => f.run(() => workflow.execute("parent", input));
  const write = (name, text) => { const path = join(root, name); writeFileSync(path, text); return path; };
  const result = (attempt, candidate) => `- Task: T001\n- Contract revision: 1\n- Attempt: ${attempt}\n- Input snapshot: ${base}\n- Candidate snapshot: ${candidate}\n- Outcome: complete\n`;

  await action({ action: "adopt", generation });
  await action({ action: "dispatch", task: "T001" });
  let summary = await action({ action: "status" });
  const attempt = summary.tasks.find(item => item.task === "T001");
  const lane = summary.lanes.find(item => item.name === attempt.lane);
  await assert.rejects(action({ action: "dispatch", task: "T002" }), /Owned paths or exclusive resources remain occupied/,
    "static overlap removal does not let two live attempts share a path");
  await f.run(async () => { assert.equal(f.facts.get(attempt.workerId).turnId, attempt.turnId); f.finish(attempt.workerId, "unused placeholder"); });

  writeFileSync(join(lane.path, "a.txt"), "changed\n"); git(lane.path, "add", "a.txt"); git(lane.path, "commit", "-m", "own change");
  const owned = git(lane.path, "rev-parse", "HEAD");
  writeFileSync(join(lane.path, "b.txt"), "unowned change\n"); git(lane.path, "add", "b.txt"); git(lane.path, "commit", "-m", "unowned change");
  const outside = git(lane.path, "rev-parse", "HEAD");

  await assert.rejects(action({ action: "record-result", task: "T001", result: write("wrong-attempt.md", result(9, owned)) }),
    /Result must bind this attempt\/input/);
  await assert.rejects(action({ action: "record-result", task: "T001", result: write("outside.md", result(1, outside)) }),
    /Candidate changes files outside frozen ownership/);

  git(lane.path, "checkout", "--detach", owned);
  await action({ action: "record-result", task: "T001", result: write("owned.md", result(1, owned)) });
  const review = (await action({ action: "status" })).tasks.find(item => item.task === "T001").review;
  await f.run(async () => {
    assert.equal(f.facts.get(review.worker).turnId, review.turn);
    f.finish(review.worker, JSON.stringify({ candidate: owned, input: base, verdict: "changes-required", findings: "Needs another pass." }));
  });
  await assert.rejects(action({ action: "accept", task: "T001" }), /Independent candidate review has not passed/);
  await assert.rejects(action({ action: "release", task: "T001", processesStopped: true }), /Deliver or archive retained evidence before releasing the lane/);
  await assert.rejects(action({ action: "complete" }), /outstanding disposition/);
  summary = await action({ action: "status" });
  assert.equal(summary.tasks.find(item => item.task === "T001").candidate, owned);
});
