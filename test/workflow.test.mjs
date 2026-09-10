import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ROLES, Workflow, WorkflowStore, Workers } from "../lib/index.js";
import { Backend } from "./backend.mjs";

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

test("managed no-lane attempt enforces result, acceptance, delivery, and release", async t => {
  const root = mkdtempSync(join(tmpdir(), "workflow-managed-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo"); mkdirSync(repo); git(repo, "init", "-b", "main"); git(repo, "config", "user.email", "test@example.invalid"); git(repo, "config", "user.name", "Test");
  writeFileSync(join(repo, "a.txt"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD"), generation = join(repo, "agentwork", "fixture", "generation-1"); mkdirSync(join(generation, "tasks"), { recursive: true });
  writeFileSync(join(generation, "plan.md"), `- Schema: 1\n- Revision: 1\n- Repository: ${repo}\n- Target: refs/heads/main\n- Base: ${base}\n- Delivery: target-merge\n## Goal\nFixture\n## Acceptance\nFinish.\n## Lane policy\n- Initial lanes: 1\n- Max lanes: 1\n- Expand: no\n- Bases: ["plan", "target"]\n- Isolation: worktree\n- Merge method: merge\n`);
  writeFileSync(join(generation, "tasks.md"), "## T001\n- State: executable\n- Revision: 1\n## T002\n- State: executable\n- Revision: 1\n");
  writeFileSync(join(generation, "tasks", "T001.md"), `- Revision: 1\n- Kind: investigation\n- Role: evidence_runner\n- Depends on: []\n- Owned paths: []\n- Resources: []\n- Inputs: ["${base}"]\n- Review: dispatcher\n- Lane: no\n- Cwd: .\n- Read paths: ["."]\n## Goal\nInspect.\n## Acceptance\nReturn evidence.\n## Constraints\nRead only.\n## Validation\nCheck fixture.\n## Return when\nDone.\n`);
  writeFileSync(join(generation, "tasks", "T002.md"), `- Revision: 1\n- Kind: implementation\n- Role: def_coding_worker\n- Depends on: []\n- Owned paths: ["a.txt"]\n- Resources: []\n- Inputs: ["${base}"]\n- Review: independent\n## Goal\nChange file.\n## Acceptance\nTarget receives change.\n## Constraints\nOwn a.txt.\n## Validation\nRead file.\n## Return when\nDone.\n`);
  const backend = new Backend(), workers = new Workers(backend, new WorkflowStore(join(root, "state")), "/skills/codex-workflow"), workflow = new Workflow(workers, "/skills/codex-workflow");
  await workflow.execute("parent", { action: "adopt", generation }); await workflow.execute("parent", { action: "dispatch", task: "T001" });
  let summary = await workflow.execute("parent", { action: "status" }), attempt = summary.tasks[0];
  await assert.rejects(workers.append("parent", attempt.workerId, "bypass"), /requires codex_workflow/);
  backend.complete("workflow:parent", attempt.workerId, attempt.turnId, `- Task: T001\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${base}\n- Outcome: complete\n`);
  await workflow.execute("parent", { action: "record-result", task: "T001" }); await workflow.execute("parent", { action: "accept", task: "T001" }); await workflow.execute("parent", { action: "integrate", task: "T001" });
  summary = await workflow.execute("parent", { action: "release", task: "T001", processesStopped: true });
  assert.equal(summary.tasks[0].state, "released");
  assert.equal(backend.sessions.get(`workflow:parent/${attempt.workerId}`).model, ROLES.find(role => role.name === "evidence_runner").model);
  await workflow.execute("parent", { action: "dispatch", task: "T002" }); summary = await workflow.execute("parent", { action: "status" }); attempt = summary.tasks.find(item => item.task === "T002");
  const lane = summary.lanes.find(item => item.name === attempt.lane); writeFileSync(join(lane.path, "a.txt"), "changed\n"); git(lane.path, "add", "a.txt"); git(lane.path, "commit", "-m", "change"); const candidate = git(lane.path, "rev-parse", "HEAD");
  backend.complete("workflow:parent", attempt.workerId, attempt.turnId, `- Task: T002\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${candidate}\n- Outcome: complete\n`);
  await workflow.execute("parent", { action: "record-result", task: "T002" }); summary = await workflow.execute("parent", { action: "status" }); const review = summary.tasks.find(item => item.task === "T002").review;
  backend.complete("workflow:parent", review.worker, review.turn, JSON.stringify({ candidate, input: base, verdict: "passed", findings: "Verified candidate" }));
  await workflow.execute("parent", { action: "accept", task: "T002" }); await workflow.execute("parent", { action: "integrate", task: "T002" });
  assert.equal(readFileSync(join(repo, "a.txt"), "utf8"), "changed\n");
  summary = await workflow.execute("parent", { action: "release", task: "T002", processesStopped: true }); assert.equal(summary.tasks.find(item => item.task === "T002").state, "released");
  await workers.close();
});
