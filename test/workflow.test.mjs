import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexSessionBackend } from "dsh-codex-kit-backend";
import { ROLES, Workflow, WorkflowStore, WorkflowWorkers } from "../lib/index.js";

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const caller = { nativeSessionId: "parent", source: "agent", parentAgent: { id: "agent", nativeSessionId: "parent" } };

class Server extends EventEmitter {
  calls = []; turn = 0;
  constructor(hub) { super(); this.hub = hub; hub.servers.push(this); }
  async connect() {}
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === "thread/start") {
      this.threadId = `thread-${++this.hub.thread}`;
      const roots = Object.keys(params.config?.permissions?.["dsh-task"]?.filesystem ?? {}).filter(path => path !== ":root");
      return { thread: { id: this.threadId }, model: params.model, reasoningEffort: params.config?.model_reasoning_effort,
        ...(params.approvalPolicy === "never" ? { sandbox: { type: "workspaceWrite", writableRoots: roots, excludeSlashTmp: true, excludeTmpdirEnvVar: true, networkAccess: params.config?.["features.network_proxy"] === true }, approvalPolicy: "never" } : {}) };
    }
    if (method === "thread/resume") { this.threadId = params.threadId; return { thread: { id: params.threadId, status: { type: "idle" }, turns: [] }, model: params.model, reasoningEffort: params.config?.model_reasoning_effort }; }
    if (method === "turn/start") { const id = `turn-${++this.turn}`; this.emit("notification", { method: "turn/started", params: { threadId: params.threadId, turn: { id } } }); return { turn: { id, status: "inProgress" } }; }
    return {};
  }
  respond() {} reject() {} async close() {}
}

test("managed no-lane attempt enforces result, acceptance, delivery, and release", async t => {
  const root = mkdtempSync(join(tmpdir(), "workflow-managed-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo"); mkdirSync(repo); git(repo, "init", "-b", "main"); git(repo, "config", "user.email", "test@example.invalid"); git(repo, "config", "user.name", "Test");
  writeFileSync(join(repo, "a.txt"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD"), generation = join(repo, "agentwork", "fixture", "generation-1"); mkdirSync(join(generation, "tasks"), { recursive: true });
  writeFileSync(join(generation, "plan.md"), `- Schema: 1\n- Revision: 1\n- Repository: ${repo}\n- Target: refs/heads/main\n- Base: ${base}\n- Delivery: target-merge\n## Goal\nFixture\n## Acceptance\nFinish.\n## Lane policy\n- Initial lanes: 1\n- Max lanes: 1\n- Expand: no\n- Bases: ["plan", "target"]\n- Isolation: worktree\n- Merge method: merge\n`);
  writeFileSync(join(generation, "tasks.md"), ["T001", "T002", "T003", "T004", "T005", "T006", "T007"].map(id => `## ${id}\n- State: executable\n- Revision: 1\n`).join(""));
  writeFileSync(join(generation, "tasks", "T001.md"), `- Revision: 1\n- Kind: investigation\n- Role: evidence_runner\n- Depends on: []\n- Owned paths: []\n- Resources: []\n- Inputs: ["${base}"]\n- Review: dispatcher\n- Lane: no\n- Cwd: .\n- Read paths: ["."]\n## Goal\nInspect.\n## Acceptance\nReturn evidence.\n## Constraints\nRead only.\n## Validation\nCheck fixture.\n## Return when\nDone.\n`);
  writeFileSync(join(generation, "tasks", "T002.md"), `- Revision: 1\n- Kind: implementation\n- Role: def_coding_worker\n- Depends on: []\n- Owned paths: ["a.txt"]\n- Resources: []\n- Inputs: ["${base}"]\n- Review: independent\n## Goal\nChange file.\n## Acceptance\nTarget receives change.\n## Constraints\nOwn a.txt.\n## Validation\nRead file.\n## Return when\nDone.\n`);
  for (const id of ["T003", "T004", "T005", "T006", "T007"]) writeFileSync(join(generation, "tasks", `${id}.md`), `- Revision: 1\n- Kind: investigation\n- Role: evidence_runner\n- Depends on: []\n- Owned paths: []\n- Resources: []\n- Inputs: ["${base}"]\n- Review: dispatcher\n- Lane: no\n- Cwd: .\n- Read paths: ["."]\n## Goal\nRecover ${id}.\n## Acceptance\nReturn evidence.\n## Constraints\nRead only.\n## Validation\nCheck fixture.\n## Return when\nDone.\n`);
  const hub = { servers: [], thread: 0 }, backend = new CodexSessionBackend(join(root, "backend"), () => new Server(hub));
  const roles = new Map(ROLES.map(value => [value.name, { name: value.name, developerInstructions: `Execute ${value.name}`, model: value.model, reasoningEffort: value.effort }]));
  const registration = backend.registerWorkflow({ listRoles: () => [...roles.values()], resolveRole: name => { const value = roles.get(name); if (!value) throw new Error("Unknown role"); return value; }, authorize() {} });
  const store = new WorkflowStore(join(root, "state"));
  const workers = new WorkflowWorkers(backend, store, (actual, id, action, operation) => registration.run(actual, id, action, operation), "/skills/codex-workflow"), workflow = new Workflow(workers, "/skills/codex-workflow");
  const action = input => workers.run(caller, () => {}, () => workflow.execute("parent", input));
  const finish = async (id, turnId, text) => workers.run(caller, () => {}, async () => { const worker = await workers.get("parent", id), server = hub.servers.find(value => value.threadId === worker.threadId); server.emit("notification", { method: "item/completed", params: { threadId: worker.threadId, turnId, item: { type: "agentMessage", phase: "final_answer", text } } }); server.emit("notification", { method: "turn/completed", params: { threadId: worker.threadId, turn: { id: turnId, status: "completed" } } }); });
  t.after(() => backend.close());
  await action({ action: "adopt", generation }); await action({ action: "dispatch", task: "T001" });
  let summary = await action({ action: "status" }), attempt = summary.tasks[0];
  await assert.rejects(backend.configureSession(caller, attempt.workerId, {}), /requires codex_workflow/);
  await finish(attempt.workerId, attempt.turnId, `- Task: T001\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${base}\n- Outcome: complete\n`);
  await action({ action: "record-result", task: "T001" });
  const save = store.save.bind(store); let failAcceptSaves = 2;
  store.save = () => { if (failAcceptSaves > 0) { failAcceptSaves--; throw new Error("injected orchestration save failure"); } save(); };
  await assert.rejects(action({ action: "accept", task: "T001" }), /injected orchestration save failure/);
  summary = await action({ action: "status" }); assert.equal(summary.tasks[0].state, "candidate", "failed W save rolls back only unpersisted attempt state");
  const acceptedReport = await workers.run(caller, () => {}, async () => (await workers.get("parent", attempt.workerId)).reports.find(report => report.turnId === attempt.turnId));
  assert.equal(acceptedReport.acceptance, "accepted", "B acceptance is not rolled back");
  await assert.rejects(action({ action: "integrate", task: "T001" }), /Accept the task candidate/);
  await assert.rejects(action({ action: "accept", task: "T001" }), /injected orchestration save failure/);
  assert.equal((await action({ action: "status" })).tasks[0].state, "candidate", "repeated save failures remain retryable");
  await action({ action: "accept", task: "T001" });
  const retriedReport = await workers.run(caller, () => {}, async () => (await workers.get("parent", attempt.workerId)).reports.find(report => report.turnId === attempt.turnId));
  assert.equal(retriedReport.acknowledgedAt, acceptedReport.acknowledgedAt, "retry reuses the same accepted report");
  assert.equal(new WorkflowStore(join(root, "state")).read().runs[0].attempts[0].state, "accepted", "retry persists accepted state for restart");
  await action({ action: "integrate", task: "T001" });
  summary = await action({ action: "release", task: "T001", processesStopped: true });
  assert.equal(summary.tasks[0].state, "released");
  assert.equal(hub.servers.flatMap(server => server.calls).find(call => call.method === "thread/start" && call.params.developerInstructions === "Execute evidence_runner").params.model, ROLES.find(role => role.name === "evidence_runner").model);
  await action({ action: "dispatch", task: "T002" }); summary = await action({ action: "status" }); attempt = summary.tasks.find(item => item.task === "T002");
  const lane = summary.lanes.find(item => item.name === attempt.lane); writeFileSync(join(lane.path, "a.txt"), "changed\n"); git(lane.path, "add", "a.txt"); git(lane.path, "commit", "-m", "change"); const candidate = git(lane.path, "rev-parse", "HEAD");
  await finish(attempt.workerId, attempt.turnId, `- Task: T002\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${candidate}\n- Outcome: complete\n`);
  await action({ action: "record-result", task: "T002" }); summary = await action({ action: "status" }); const review = summary.tasks.find(item => item.task === "T002").review;
  await finish(review.worker, review.turn, JSON.stringify({ candidate, input: base, verdict: "passed", findings: "Verified candidate" }));
  await action({ action: "accept", task: "T002" }); await action({ action: "integrate", task: "T002" });
  assert.equal(readFileSync(join(repo, "a.txt"), "utf8"), "changed\n");
  const recoveryBase = git(repo, "rev-parse", "HEAD");
  summary = await action({ action: "release", task: "T002", processesStopped: true }); assert.equal(summary.tasks.find(item => item.task === "T002").state, "released");

  const count = method => hub.servers.flatMap(server => server.calls).filter(call => call.method === method).length;
  const originalCreate = workers.create.bind(workers), originalAppend = workers.append.bind(workers);
  let lose = true;
  workers.create = async (...args) => { const value = await originalCreate(...args); if (lose) { lose = false; throw new Error("create response lost"); } return value; };
  const createThreads = count("thread/start"), createTurns = count("turn/start");
  await assert.rejects(action({ action: "dispatch", task: "T003", base: recoveryBase }), /create response lost/); workers.create = originalCreate;
  let recovered = (await action({ action: "status" })).tasks.find(item => item.task === "T003"), stable = { workerId: recovered.workerId, lane: recovered.lane };
  const recoverySave = store.save.bind(store); let failRecoverySave = true;
  store.save = () => { if (failRecoverySave) { failRecoverySave = false; throw new Error("injected recovery save failure"); } recoverySave(); };
  await assert.rejects(action({ action: "dispatch", task: "T003", base: recoveryBase }), /injected recovery save failure/);
  recovered = (await action({ action: "status" })).tasks.find(item => item.task === "T003"); assert.equal(recovered.state, "unknown"); assert.equal(recovered.turnId, undefined);
  const afterRecoverySaveFailure = { threads: count("thread/start"), turns: count("turn/start") };
  await action({ action: "dispatch", task: "T003", base: recoveryBase }); recovered = (await action({ action: "status" })).tasks.find(item => item.task === "T003");
  assert.deepEqual({ workerId: recovered.workerId, lane: recovered.lane }, stable); assert.equal(recovered.state, "running"); assert.ok(recovered.turnId);
  assert.equal(count("thread/start"), createThreads + 1); assert.equal(count("turn/start"), createTurns + 1, "confirmed unsent initial turn is appended once");
  assert.deepEqual({ threads: count("thread/start"), turns: count("turn/start") }, afterRecoverySaveFailure, "retry after recovery save failure only records the observed turn");

  lose = true;
  workers.append = async (...args) => { const value = await originalAppend(...args); if (lose) { lose = false; throw new Error("append response lost"); } return value; };
  const appendThreads = count("thread/start"), appendTurns = count("turn/start");
  await assert.rejects(action({ action: "dispatch", task: "T004", base: recoveryBase }), /append response lost/); workers.append = originalAppend;
  recovered = (await action({ action: "status" })).tasks.find(item => item.task === "T004"); stable = { workerId: recovered.workerId, lane: recovered.lane };
  await action({ action: "dispatch", task: "T004", base: recoveryBase }); recovered = (await action({ action: "status" })).tasks.find(item => item.task === "T004");
  assert.deepEqual({ workerId: recovered.workerId, lane: recovered.lane }, stable); assert.equal(recovered.state, "running"); assert.ok(recovered.turnId);
  assert.equal(count("thread/start"), appendThreads + 1); assert.equal(count("turn/start"), appendTurns + 1, "observed running turn is not appended again");

  lose = true;
  workers.append = async (...args) => {
    const value = await originalAppend(...args);
    if (lose) { lose = false; await finish(args[1], value.turnId, `- Task: T005\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${recoveryBase}\n- Candidate snapshot: ${recoveryBase}\n- Outcome: complete\n`); throw new Error("completed append response lost"); }
    return value;
  };
  const completeThreads = count("thread/start"), completeTurns = count("turn/start");
  await assert.rejects(action({ action: "dispatch", task: "T005", base: recoveryBase }), /completed append response lost/); workers.append = originalAppend;
  recovered = (await action({ action: "status" })).tasks.find(item => item.task === "T005"); stable = { workerId: recovered.workerId, lane: recovered.lane };
  await action({ action: "dispatch", task: "T005", base: recoveryBase }); recovered = (await action({ action: "status" })).tasks.find(item => item.task === "T005");
  assert.deepEqual({ workerId: recovered.workerId, lane: recovered.lane }, stable); assert.equal(recovered.state, "unknown"); assert.ok(recovered.turnId);
  assert.equal(count("thread/start"), completeThreads + 1); assert.equal(count("turn/start"), completeTurns + 1, "terminal report prevents append replay");
  await action({ action: "record-result", task: "T005" });

  lose = true;
  workers.create = async (...args) => { const value = await originalCreate(...args); if (lose) { lose = false; throw new Error("create response lost before get failure"); } return value; };
  await assert.rejects(action({ action: "dispatch", task: "T006", base: recoveryBase }), /create response lost before get failure/); workers.create = originalCreate;
  const originalGet = workers.get.bind(workers), beforeGetFailure = (await action({ action: "status" })).tasks.find(item => item.task === "T006"), callsBeforeGetFailure = { threads: count("thread/start"), turns: count("turn/start") };
  workers.get = async () => { throw new Error("injected get failure"); };
  await assert.rejects(action({ action: "dispatch", task: "T006", base: recoveryBase }), /preserved unknown attempt: Error: injected get failure/); workers.get = originalGet;
  const afterGetFailure = (await action({ action: "status" })).tasks.find(item => item.task === "T006");
  assert.deepEqual(afterGetFailure, beforeGetFailure); assert.deepEqual({ threads: count("thread/start"), turns: count("turn/start") }, callsBeforeGetFailure);
  await action({ action: "dispatch", task: "T006", base: recoveryBase });

  lose = true;
  workers.append = async (...args) => { const value = await originalAppend(...args); if (lose) { lose = false; throw new Error("append response lost before mismatch"); } return value; };
  await assert.rejects(action({ action: "dispatch", task: "T007", base: recoveryBase }), /append response lost before mismatch/); workers.append = originalAppend;
  const storedAttempt = store.read().runs[0].attempts.find(item => item.task.id === "T007"); storedAttempt.turn = "wrong-turn"; store.save();
  const mismatchCalls = { threads: count("thread/start"), turns: count("turn/start") };
  await assert.rejects(action({ action: "dispatch", task: "T007", base: recoveryBase }), /turn identity mismatch/);
  assert.equal((await action({ action: "status" })).tasks.find(item => item.task === "T007").turnId, "wrong-turn");
  assert.deepEqual({ threads: count("thread/start"), turns: count("turn/start") }, mismatchCalls);
});
