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
  writeFileSync(join(generation, "tasks.md"), "## T001\n- State: executable\n- Revision: 1\n## T002\n- State: executable\n- Revision: 1\n");
  writeFileSync(join(generation, "tasks", "T001.md"), `- Revision: 1\n- Kind: investigation\n- Role: evidence_runner\n- Depends on: []\n- Owned paths: []\n- Resources: []\n- Inputs: ["${base}"]\n- Review: dispatcher\n- Lane: no\n- Cwd: .\n- Read paths: ["."]\n## Goal\nInspect.\n## Acceptance\nReturn evidence.\n## Constraints\nRead only.\n## Validation\nCheck fixture.\n## Return when\nDone.\n`);
  writeFileSync(join(generation, "tasks", "T002.md"), `- Revision: 1\n- Kind: implementation\n- Role: def_coding_worker\n- Depends on: []\n- Owned paths: ["a.txt"]\n- Resources: []\n- Inputs: ["${base}"]\n- Review: independent\n## Goal\nChange file.\n## Acceptance\nTarget receives change.\n## Constraints\nOwn a.txt.\n## Validation\nRead file.\n## Return when\nDone.\n`);
  const hub = { servers: [], thread: 0 }, backend = new CodexSessionBackend(join(root, "backend"), () => new Server(hub));
  const roles = new Map(ROLES.map(value => [value.name, { name: value.name, developerInstructions: `Execute ${value.name}`, model: value.model, reasoningEffort: value.effort }]));
  const registration = backend.registerWorkflow({ listRoles: () => [...roles.values()], resolveRole: name => { const value = roles.get(name); if (!value) throw new Error("Unknown role"); return value; }, authorize() {} });
  const workers = new WorkflowWorkers(backend, new WorkflowStore(join(root, "state")), (actual, id, action, operation) => registration.run(actual, id, action, operation), "/skills/codex-workflow"), workflow = new Workflow(workers, "/skills/codex-workflow");
  const action = input => workers.run(caller, () => {}, () => workflow.execute("parent", input));
  const finish = async (id, turnId, text) => workers.run(caller, () => {}, async () => { const worker = await workers.get("parent", id), server = hub.servers.find(value => value.threadId === worker.threadId); server.emit("notification", { method: "item/completed", params: { threadId: worker.threadId, turnId, item: { type: "agentMessage", phase: "final_answer", text } } }); server.emit("notification", { method: "turn/completed", params: { threadId: worker.threadId, turn: { id: turnId, status: "completed" } } }); });
  t.after(() => backend.close());
  await action({ action: "adopt", generation }); await action({ action: "dispatch", task: "T001" });
  let summary = await action({ action: "status" }), attempt = summary.tasks[0];
  await assert.rejects(backend.configureSession(caller, attempt.workerId, {}), /requires codex_workflow/);
  await finish(attempt.workerId, attempt.turnId, `- Task: T001\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${base}\n- Outcome: complete\n`);
  await action({ action: "record-result", task: "T001" }); await action({ action: "accept", task: "T001" }); await action({ action: "integrate", task: "T001" });
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
  summary = await action({ action: "release", task: "T002", processesStopped: true }); assert.equal(summary.tasks.find(item => item.task === "T002").state, "released");
});
