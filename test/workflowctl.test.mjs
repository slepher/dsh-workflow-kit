import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ROLES } from "../lib/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "scripts", "workflowctl.py");

/** The execution-role catalogue the Host supplies through the environment. */
const ROLE_PROFILES = JSON.stringify(Object.fromEntries(ROLES.map(role => [role.name,
  { model: role.model, model_reasoning_effort: role.effort }])));

/**
 * Run this package's contract CLI exactly as the Host does.
 * @param args - CLI arguments, without the interpreter or script path.
 * @returns the exit status and captured output.
 */
function workflowctl(...args) {
  try {
    const stdout = execFileSync("python3", [cli, ...args], { encoding: "utf8",
      env: { ...process.env, DSH_ROLE_PROFILES: ROLE_PROFILES } });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status ?? 1, stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? "") };
  }
}

/** The machine lane section every executable plan must still carry. */
const LANE_POLICY = "\n## Lane policy\n- Initial lanes: 1\n- Max lanes: 1\n- Expand: no\n"
  + '- Bases: ["plan", "target"]\n- Isolation: worktree\n- Merge method: merge\n';

/** One repository and generation directory, with every field the Host requires. */
function generation(t, { plan = {}, task = {}, index = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "workflowctl-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const dir = join(repo, "agentwork", "goal", "generation-1");
  mkdirSync(join(dir, "tasks"), { recursive: true });
  const base = "0".repeat(40);
  // `body` is the prose an author writes; the machine sections are separate, so
  // a fixture may drop every fixed prose heading without breaking the layout.
  const { body: planBody, ...planFields } = plan;
  const { body: taskBody, ...taskFields } = task;
  const fields = { Schema: "1", Revision: "1", Repository: repo, Target: "refs/heads/main",
    Base: base, Delivery: "working-tree", ...planFields };
  writeFileSync(join(dir, "plan.md"), `${Object.entries(fields).map(([key, value]) => `- ${key}: ${value}`).join("\n")}\n`
    + (planBody ?? "## Goal\nFixture\n## Acceptance\nFinish.\n") + LANE_POLICY);
  const tasks = index.tasks ?? ["T001"];
  writeFileSync(join(dir, "tasks.md"), tasks.map(id => `## ${id}\n- State: executable\n- Revision: 1\n`).join(""));
  for (const id of tasks) {
    const contractFields = { Revision: "1", Kind: "investigation", Role: "evidence_runner", "Depends on": "[]",
      "Owned paths": "[]", Resources: "[]", Inputs: `["${base}"]`, Review: "manager", ...taskFields };
    writeFileSync(join(dir, "tasks", `${id}.md`), `${Object.entries(contractFields).map(([key, value]) => `- ${key}: ${value}`).join("\n")}\n`
      + (taskBody === undefined ? "## Goal\nInspect.\n## Acceptance\nReturn evidence.\n" : taskBody));
  }
  return { root, repo, dir, base };
}

test("C-T01: missing or emptied prose headings no longer block a readable contract", t => {
  const g = generation(t, { plan: { body: "Free prose with no fixed headings at all.\n" },
    task: { body: "## Goal\n\n## Acceptance\nDo it.\n## Anything else\nStill readable.\n" } });
  assert.equal(workflowctl("validate", g.dir).status, 0, workflowctl("validate", g.dir).stderr);
  const exported = workflowctl("export-dsh", g.dir);
  assert.equal(exported.status, 0, exported.stderr);
  const plan = JSON.parse(exported.stdout);
  assert.match(plan.text, /Free prose with no fixed headings/, "the exported plan text is unchanged");
  assert.match(plan.tasks.T001.text, /## Anything else/, "the exported contract text is unchanged");
});

test("C-T02: a no-lane task without Read paths still exports the default read scope", t => {
  const g = generation(t, { task: { Kind: "investigation", Role: "evidence_runner", Lane: "no", Cwd: ".", Review: "manager" } });
  const exported = workflowctl("export-dsh", g.dir);
  assert.equal(exported.status, 0, exported.stderr);
  assert.deepEqual(JSON.parse(exported.stdout).tasks.T001.reads, ["."], "an absent Read paths keeps the shipped default");
});

test("C-T03: Read paths accept prose strings but stay a typed array", t => {
  const ok = generation(t, { task: { Kind: "investigation", Role: "evidence_runner", "Read paths": '["src", "the docs/ directory, not a write grant"]' } });
  assert.equal(workflowctl("export-dsh", ok.dir).status, 0);
  const bad = generation(t, { task: { Kind: "investigation", Role: "evidence_runner", "Read paths": "src" } });
  assert.match(workflowctl("export-dsh", bad.dir).stderr, /requires a JSON array/);
  const nonString = generation(t, { task: { Kind: "investigation", Role: "evidence_runner", "Read paths": '["src", 7]' } });
  assert.match(workflowctl("export-dsh", nonString.dir).stderr, /requires nonempty strings/);
  // Write paths keep the exact-path rule this change does not touch.
  const write = generation(t, { task: { Kind: "implementation", Role: "coding_worker", "Write paths": '["../outside.txt"]' } });
  assert.match(workflowctl("export-dsh", write.dir).stderr, /unsafe or non-exact owned path/);
});

test("C-T04: repeated array entries are legal and an unsafe owned path is still refused", t => {
  const repeated = generation(t, { task: { Kind: "investigation", Role: "evidence_runner",
    "Owned paths": '["none", "none"]', Resources: '["cpu", "cpu"]' } });
  // A read-only role may not own product paths at all, so use a coding contract
  // for the ownership spelling and keep the array rule under test separately.
  assert.match(workflowctl("export-dsh", repeated.dir).stderr, /read-only role cannot own product writes/);
  const coding = generation(t, { task: { Kind: "implementation", Role: "coding_worker",
    "Owned paths": '["src", "src/"]', Resources: '["cpu", "cpu"]' } });
  const exported = workflowctl("export-dsh", coding.dir);
  assert.equal(exported.status, 0, exported.stderr);
  assert.deepEqual(JSON.parse(exported.stdout).tasks.T001.owned, ["src", "src/"], "the contract is exported verbatim");
  const unsafe = generation(t, { task: { Kind: "implementation", Role: "coding_worker", "Owned paths": '["../escape"]' } });
  assert.match(workflowctl("export-dsh", unsafe.dir).stderr, /unsafe or non-exact owned path/);
  const wildcard = generation(t, { task: { Kind: "implementation", Role: "coding_worker", "Owned paths": '["src/*"]' } });
  assert.match(workflowctl("export-dsh", wildcard.dir).stderr, /unsafe or non-exact owned path/);
});

test("C-T05: two independent executable tasks may declare the same ownership", t => {
  const g = generation(t, { index: { tasks: ["T001", "T002"] },
    task: { Kind: "implementation", Role: "coding_worker", "Owned paths": '["a.txt"]' } });
  const exported = workflowctl("export-dsh", g.dir);
  assert.equal(exported.status, 0, exported.stderr);
  assert.deepEqual(Object.keys(JSON.parse(exported.stdout).tasks), ["T001", "T002"],
    "the plan is published; the Host decides actual occupancy at dispatch");
});

test("C-T06: an empty Inputs array is a legal field value", t => {
  const g = generation(t, { task: { Kind: "investigation", Role: "evidence_runner", Inputs: "[]" } });
  const exported = workflowctl("export-dsh", g.dir);
  assert.equal(exported.status, 0, exported.stderr);
  assert.deepEqual(JSON.parse(exported.stdout).tasks.T001.inputs, []);
  const malformed = generation(t, { task: { Kind: "investigation", Role: "evidence_runner", Inputs: "none" } });
  assert.match(workflowctl("export-dsh", malformed.dir).stderr, /requires a JSON array/);
});

test("C-T07: a result is identified by its fields, not by its file name", t => {
  const g = generation(t, { task: { Kind: "investigation", Role: "evidence_runner" } });
  const contract = join(g.dir, "tasks", "T001.md");
  const base = g.base;
  const result = join(g.root, "anything-at-all.md");
  writeFileSync(result, `- Task: T001\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${base}\n- Outcome: complete\n`);
  const checked = workflowctl("result-check", result, "--contract", contract, "--json");
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).Task, "T001");
  // Identity fields still bind: another task or contract revision is refused.
  const other = join(g.root, "other.md");
  writeFileSync(other, `- Task: T002\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${base}\n- Outcome: complete\n`);
  assert.match(workflowctl("result-check", other, "--contract", contract).stderr, /does not match retained contract identity/);
  const stale = join(g.root, "stale.md");
  writeFileSync(stale, `- Task: T001\n- Contract revision: 2\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${base}\n- Outcome: complete\n`);
  assert.match(workflowctl("result-check", stale, "--contract", contract).stderr, /contract revision mismatch/);
});

test("C-T09: unknown, retired and cyclic dependencies plus a revision mismatch still refuse", t => {
  const unknown = generation(t, { task: { Kind: "investigation", Role: "evidence_runner", "Depends on": '["T404"]' } });
  assert.match(workflowctl("validate", unknown.dir).stderr, /unknown dependency/);
  const retired = generation(t, { index: { tasks: ["T001", "T002"] } });
  writeFileSync(join(retired.dir, "tasks.md"), "## T001\n- State: executable\n- Revision: 1\n## T002\n- State: retired\n- Revision: 1\n");
  writeFileSync(join(retired.dir, "tasks", "T001.md"), "- Revision: 1\n- Kind: investigation\n- Role: evidence_runner\n- Depends on: [\"T002\"]\n- Owned paths: []\n- Resources: []\n- Inputs: []\n- Review: manager\n## Goal\nInspect.\n");
  assert.match(workflowctl("validate", retired.dir).stderr, /dependency is retired/);
  const cyclic = generation(t, { index: { tasks: ["T001", "T002"] },
    task: { Kind: "investigation", Role: "evidence_runner", "Depends on": '["T002"]' } });
  writeFileSync(join(cyclic.dir, "tasks", "T002.md"), "- Revision: 1\n- Kind: investigation\n- Role: evidence_runner\n- Depends on: [\"T001\"]\n- Owned paths: []\n- Resources: []\n- Inputs: []\n- Review: manager\n## Goal\nInspect.\n");
  assert.match(workflowctl("validate", cyclic.dir).stderr, /dependency cycle/);
  const mismatch = generation(t);
  writeFileSync(join(mismatch.dir, "tasks", "T001.md"), "- Revision: 2\n- Kind: investigation\n- Role: evidence_runner\n- Depends on: []\n- Owned paths: []\n- Resources: []\n- Inputs: []\n- Review: manager\n## Goal\nInspect.\n");
  assert.match(workflowctl("validate", mismatch.dir).stderr, /contract\/index revision mismatch/);
});

test("a legacy fixture that still uses every complete heading stays readable", t => {
  const g = generation(t, { task: { Kind: "implementation", Role: "coding_worker", "Owned paths": '["a.txt"]',
    "Write paths": '["a.txt"]', body: "## Goal\nChange it.\n## Acceptance\nChanged.\n## Constraints\nOwn a.txt.\n## Validation\nRead it.\n## Return when\nDone.\n" } });
  const exported = workflowctl("export-dsh", g.dir);
  assert.equal(exported.status, 0, exported.stderr);
  const task = JSON.parse(exported.stdout).tasks.T001;
  assert.deepEqual(task.owned, ["a.txt"]);
  assert.deepEqual(task.writes, ["a.txt"]);
  assert.equal(task.review, "manager");
});
