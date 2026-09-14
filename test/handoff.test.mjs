import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "./native-fixture.mjs";
import { Workflow, WorkflowStore } from "../lib/index.js";

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

/** Distinct sup/def coding configurations a bootstrap handoff can move between. */
const DISTINCT = {
  reviewer: { provider: "codex", model: "review-model", reasoningEffort: "high" },
  def_coding_worker: { provider: "codex", model: "def-model", reasoningEffort: "medium" },
  sup_coding_worker: { provider: "codex", model: "sup-model", reasoningEffort: "high" },
};

const HANDOFF_REPORT = [
  "Execution control: handoff",
  "Target tier: def",
  "Summary: opened the main path and verified the entry point.",
  "Remaining: finish the remaining tests and in-scope repairs.",
].join("\n");

/** One repository, generation and implementation contract. */
function project(t) {
  const root = mkdtempSync(join(tmpdir(), "workflow-handoff-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo"); mkdirSync(repo);
  git(repo, "init", "-b", "main"); git(repo, "config", "user.email", "test@example.invalid"); git(repo, "config", "user.name", "Test");
  writeFileSync(join(repo, "a.txt"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD"), generation = join(repo, "agentwork", "fixture", "generation-1");
  mkdirSync(join(generation, "tasks"), { recursive: true });
  writeFileSync(join(generation, "plan.md"), `- Schema: 1\n- Revision: 1\n- Repository: ${repo}\n- Target: refs/heads/main\n- Base: ${base}\n- Delivery: target-merge\n## Goal\nFixture\n## Acceptance\nFinish.\n## Lane policy\n- Initial lanes: 1\n- Max lanes: 1\n- Expand: no\n- Bases: ["plan", "target"]\n- Isolation: worktree\n- Merge method: merge\n`);
  writeFileSync(join(generation, "tasks.md"), "## T001\n- State: executable\n- Revision: 1\n");
  writeFileSync(join(generation, "tasks", "T001.md"), `- Revision: 1\n- Kind: implementation\n- Role: coding_worker\n- Depends on: []\n- Owned paths: ["a.txt"]\n- Resources: []\n- Inputs: ["${base}"]\n- Review: independent\n## Goal\nChange file.\n## Acceptance\nTarget receives change.\n## Constraints\nOwn a.txt.\n## Validation\nRead file.\n## Return when\nDone.\n`);
  return { repo, generation, base };
}

/**
 * Boot one dispatched bootstrap attempt and let its opening turn report a
 * handoff. The fake provider records the target binding, so the successor's
 * native facts only exist once the Host actually creates it.
 */
async function dispatched(t, { strategy = "bootstrap", threadHandoff = true, report = HANDOFF_REPORT, roles = DISTINCT, facts } = {}) {
  const { repo, generation, base } = project(t);
  const f = fixture(t, { cwd: repo, roles, threadHandoff, facts });
  f.store.selectStrategy("parent", strategy);
  const workflow = new Workflow(f.workers, "/skills/codex-workflow");
  const action = input => f.run(() => workflow.execute("parent", input));
  await action({ action: "adopt", generation });
  await action({ action: "dispatch", task: "T001" });
  let summary = await action({ action: "status" });
  const attempt = summary.tasks[0];
  await f.run(async () => { f.finish(attempt.workerId, typeof report === "function" ? report(base) : report); });
  return { f, action, attempt, base, roles };
}

test("a bootstrap opening report continues the task on a def successor child", async t => {
  const { f, action, attempt, base } = await dispatched(t);
  let summary = await action({ action: "status" });
  let task = summary.tasks.find(item => item.task === "T001");

  // The successor is a new DSH child, not the opening worker.
  const handoff = task.handoff;
  assert.equal(f.handoffCalls.length, 1, "the Host binds the thread exactly once");
  assert.equal(handoff.fromWorker, attempt.workerId, "the recorded source is the opening execution");
  assert.notEqual(handoff.toWorker, attempt.workerId, "the successor is a new child");
  assert.equal(handoff.status, "started");
  assert.equal(handoff.targetTier, "def");
  assert.deepEqual(handoff.targetConfig, { provider: "codex", model: "def-model", reasoningEffort: "medium" });
  assert.equal(handoff.requestId, `${attempt.workerId}:handoff:${handoff.sourceTurnId}`);
  assert.equal(handoff.sourceTurnId, attempt.turnId, "the source turn is the opening turn");
  assert.equal(handoff.messageId, `inbox-${handoff.toWorker}-1`);
  assert.match(handoff.prompt, /successor continuation of this coding assignment/);
  assert.match(handoff.prompt, /Codex thread the Host kept for this successor/);
  assert.match(handoff.prompt, /Remaining work:\nfinish the remaining tests/);
  assert.equal(task.state, "running", "the handoff does not end the assignment");
  assert.equal(task.tier, "def");
  assert.equal(task.phase, "continuation");
  // Until the successor's own turn is observed the source still owns the task.
  assert.equal(task.activeWorker, attempt.workerId);
  assert.equal(task.handoff.threadId, f.facts.get(attempt.workerId).threadId, "the successor keeps the original thread");

  // The successor child is created with the bound def configuration and the
  // continuation prompts, on the same workspace and authorization boundary.
  const created = f.calls.find(call => call.id === handoff.toWorker);
  assert.equal(created.options.model, "def-model");
  assert.equal(created.options.reasoningEffort, "medium");
  assert.match(f.promptText(created), /coding_worker \[coding-bootstrap-continuation,coding-adaptive\]/, "the successor's continuation instructions open its own conversation");
  assert.deepEqual(created.options.execution.boundary, f.facts.get(attempt.workerId).boundary ?? created.options.execution.boundary);
  assert.equal(f.facts.get(handoff.toWorker).threadId, f.facts.get(attempt.workerId).threadId, "the Codex thread is unchanged");
  assert.notEqual(f.facts.get(handoff.toWorker).nativeSessionId, f.facts.get(attempt.workerId).nativeSessionId, "the DSH child identity changed");

  // The successor's first completed turn confirms the handover from native facts.
  await f.run(async () => { f.finish(handoff.toWorker, "continued work"); });
  summary = await action({ action: "status" });
  task = summary.tasks.find(item => item.task === "T001");
  assert.equal(task.handoff.status, "confirmed");
  assert.equal(task.handoff.targetTurnId, f.facts.get(handoff.toWorker).reports.at(-1).turnId);
  assert.equal(task.handoff.threadId, f.facts.get(attempt.workerId).threadId);
  assert.equal(task.activeWorker, handoff.toWorker, "the confirmed successor owns the task");
  assert.equal(task.handoff.requestId, handoff.requestId, "re-observation reuses the recorded request");

  // Repeated observation never creates a second successor or continuation.
  summary = await action({ action: "status" });
  assert.equal(f.calls.filter(call => call.id === handoff.toWorker).length, 1, "the continuation is delivered once");
  assert.equal(f.handoffCalls.length, 1);
  assert.equal(summary.tasks.find(item => item.task === "T001").handoff.toWorker, handoff.toWorker);

  // A late source report is history: it neither becomes the candidate nor moves
  // the active worker back.
  await f.run(async () => { f.finish(attempt.workerId, "late source report"); });
  summary = await action({ action: "status" });
  task = summary.tasks.find(item => item.task === "T001");
  assert.equal(task.activeWorker, handoff.toWorker);
  assert.equal(task.result, undefined);
  assert.ok(base);
});

test("the handoff keeps the dispatch snapshot after a Profile edit", async t => {
  const { f, action, attempt } = await dispatched(t);
  const toWorker = (await action({ action: "status" })).tasks[0].handoff.toWorker;
  // The live catalog now offers another def configuration; the successor must
  // still run the configuration captured at dispatch.
  f.configuration.setUserConfigs({ a: { roles: { ...DISTINCT, def_coding_worker: { provider: "codex", model: "edited-model", reasoningEffort: "low" } } } });
  const created = f.calls.find(call => call.id === toWorker);
  assert.equal(created.options.model, "def-model", "the bound snapshot decides the successor configuration");
  assert.equal(f.handoffCalls[0].model, "def-model");
  assert.ok(attempt.workerId);
});

test("native usage is attributed to the task and deduplicated across both children", async t => {
  const { f, action, attempt } = await dispatched(t);
  let summary = await action({ action: "status" });
  const toWorker = summary.tasks.find(item => item.task === "T001").handoff.toWorker;
  // The successor completes its first turn and one further turn with usage.
  await f.run(async () => { f.finish(toWorker, "continued"); });
  const row = f.facts.get(toWorker);
  row.number += 1; row.turnId = `${toWorker}:${row.number}`;
  await f.run(async () => { f.finish(toWorker, "done"); });
  row.reports.at(-1).usage = { totalTokens: 0, inputTokens: 100, cachedInputTokens: 20, cacheWriteInputTokens: null, outputTokens: 5, reasoningOutputTokens: 2 };

  summary = await action({ action: "status" });
  const usage = summary.tasks.find(item => item.task === "T001").usage;
  assert.equal(usage.calls, 3, "the opening turn and both successor turns are counted once each");
  assert.equal(usage.inputTokens, 100);
  assert.equal(usage.unreported, 2, "turns with no reported usage stay unreported, never zero");
  summary = await action({ action: "status" });
  assert.deepEqual(summary.tasks.find(item => item.task === "T001").usage, usage, "re-observing the same turns changes nothing");
  assert.ok(attempt.workerId);
});

test("a continuation is addressed to the successor once the handover is confirmed", async t => {
  const { f, action, attempt } = await dispatched(t);
  let summary = await action({ action: "status" });
  const toWorker = summary.tasks.find(item => item.task === "T001").handoff.toWorker;
  await f.run(async () => { f.finish(toWorker, "continued"); });
  summary = await action({ action: "status" });
  assert.equal(summary.tasks.find(item => item.task === "T001").activeWorker, toWorker);

  await action({ action: "continue", task: "T001", text: "Also cover the empty input." });
  const delivered = f.calls.filter(call => call.delivery === "queue").at(-1);
  assert.equal(delivered.id, toWorker, "the correction continues the successor, not the source");
  const record = f.store.read().nativeChildren[toWorker];
  assert.deepEqual(record.handoffFrom, { fromWorker: attempt.workerId, requestId: record.handoffFrom.requestId });
  assert.equal(f.store.read().nativeChildren[attempt.workerId].handoff.status, "confirmed", "the source keeps the history of the handover");
});

test("a control report outside its authorized phase is recorded, not performed", async t => {
  const { f, action, attempt } = await dispatched(t, { strategy: "adaptive" });
  const summary = await action({ action: "status" });
  assert.equal(f.handoffCalls.length, 0, "adaptive does not authorize a handoff");
  const task = summary.tasks.find(item => item.task === "T001");
  assert.equal(task.state, "running");
  assert.equal(task.tier, "def");
  assert.equal(task.handoff, undefined);
  assert.deepEqual(task.control, { turnId: attempt.turnId, signal: "handoff",
    reason: "execution control handoff is not authorized for adaptive phase main" });
});

test("a package set without the thread handover reports the missing route", async t => {
  const { f, action } = await dispatched(t, { threadHandoff: false });
  const summary = await action({ action: "status" });
  assert.deepEqual(summary.handoffSupport, { supported: false, threadHandoff: false, factImport: false,
    reason: "the installed package set provides neither the controlled Codex thread handover nor the sourced execution-fact projector" });
  const task = summary.tasks.find(item => item.task === "T001");
  assert.equal(task.state, "running");
  assert.equal(task.handoff, undefined);
  assert.equal(task.activeWorker, task.workerId, "the opening execution keeps the assignment");
  assert.match(task.control.reason, /cannot transfer a Codex thread/);
});

test("a declared needs-decision outcome stays visible and creates no upgrade child", async t => {
  const { f, action } = await dispatched(t, { strategy: "economy", report: base =>
    `- Task: T001\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${base}\n- Outcome: needs-decision\n` });
  const callsBefore = f.calls.length;
  const summary = await action({ action: "record-result", task: "T001" });
  const task = summary.tasks.find(item => item.task === "T001");
  assert.equal(task.attempt, f.store.read().runs[0].attempts[0].number);
  assert.equal(task.state, "blocked", "the attempt stays blocked");
  assert.equal(task.outcome, "needs-decision", "the declared outcome is preserved verbatim");
  assert.equal(f.calls.length, callsBefore, "a declared decision need never starts a higher-capability child");
});

test("the successor owns the candidate and release closes both children without touching the thread", async t => {
  const { f, action, attempt, base } = await dispatched(t);
  let summary = await action({ action: "status" });
  const toWorker = summary.tasks.find(item => item.task === "T001").handoff.toWorker;
  const thread = f.facts.get(attempt.workerId).threadId;

  // The successor continues the assignment and returns the final result.
  const lane = summary.lanes.find(item => item.name === attempt.lane);
  writeFileSync(join(lane.path, "a.txt"), "changed\n"); git(lane.path, "add", "a.txt"); git(lane.path, "commit", "-m", "change");
  const candidate = git(lane.path, "rev-parse", "HEAD");
  await f.run(async () => { f.finish(toWorker, `- Task: T001\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${candidate}\n- Outcome: complete\n`); });
  summary = await action({ action: "record-result", task: "T001" });
  let task = summary.tasks.find(item => item.task === "T001");
  assert.equal(task.state, "candidate");
  assert.equal(task.activeWorker, toWorker, "the candidate belongs to the current executor");
  assert.equal(f.facts.get(toWorker).threadId, thread, "the successor still runs on the original thread");

  const review = task.review;
  await f.run(async () => { f.finish(review.worker, JSON.stringify({ candidate, input: base, verdict: "passed", findings: "Verified candidate" })); });
  await action({ action: "accept", task: "T001" });
  await action({ action: "integrate", task: "T001" });
  summary = await action({ action: "release", task: "T001", processesStopped: true });
  task = summary.tasks.find(item => item.task === "T001");
  assert.equal(task.state, "released");
  // Both executions of the task are disposed, and closing the source never
  // closed the thread the successor continues.
  assert.equal(f.store.read().nativeChildren[attempt.workerId].closed, true);
  assert.equal(f.store.read().nativeChildren[toWorker].closed, true);
  assert.equal(f.facts.get(toWorker).threadId, thread);
  assert.equal(f.store.read().nativeChildren[attempt.workerId].handoff.threadId, thread);
  assert.equal(f.facts.get(attempt.workerId).handedOff.toSessionId, toWorker);
});

test("the recorded handover survives a restart with the same successor identity", async t => {
  const { f, action, attempt } = await dispatched(t);
  const handoff = (await action({ action: "status" })).tasks.find(item => item.task === "T001").handoff;
  // A restarted Host reads the same fixed request and successor identities from
  // durable state instead of choosing a second continuation.
  const reloaded = new WorkflowStore(f.store.stateDir).read();
  assert.equal(reloaded.nativeChildren[attempt.workerId].handoff.requestId, handoff.requestId);
  assert.equal(reloaded.nativeChildren[attempt.workerId].handoff.toWorker, handoff.toWorker);
  assert.equal(reloaded.nativeChildren[attempt.workerId].handoff.status, "started");
  assert.deepEqual(reloaded.nativeChildren[handoff.toWorker].handoffFrom, { fromWorker: attempt.workerId, requestId: handoff.requestId });
  assert.equal(reloaded.nativeChildren[handoff.toWorker].strategy.phase, "continuation");
});

const CONSULT_REPORT = report => ["Execution control: consult",
  "Question: which option keeps the wire format stable?",
  "Goal: preserve existing adapters.",
  "Choices: versioned envelope or additive field.",
  "Evidence: src/wire.ts:40 and the failing round-trip test.",
  "Expected conclusion: the option to implement and its compatibility rule.", "", report].join("\n");

const consultResult = base => `- Task: T001\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${base}\n- Outcome: needs-verification\n`;

test("an adaptive worker's consultation starts one read-only expert on the sup configuration", async t => {
  const { f, action, attempt } = await dispatched(t, { strategy: "adaptive", report: base => CONSULT_REPORT(consultResult(base)) });
  const before = f.calls.length;
  let summary = await action({ action: "status" });
  const task = summary.tasks.find(item => item.task === "T001");
  assert.equal(task.consults.length, 1, "exactly one expert is created");
  const consult = task.consults[0];
  assert.equal(consult.state, "running");
  assert.equal(consult.question, "which option keeps the wire format stable?");
  assert.equal(consult.contractRevision, 1);
  assert.equal(consult.worker, attempt.workerId, "the expert is bound to the requesting execution");

  const created = f.calls.slice(before).find(call => call.options !== undefined);
  assert.equal(created.id, consult.id, "the expert runs under the recorded child identity");
  assert.equal(created.options.model, "sup-model", "the expert uses the Profile's sup configuration");
  assert.equal(created.options.execution.boundary.cwd, f.facts.get(attempt.workerId).cwd);
  assert.equal(created.options.execution.boundary.writableRoots.some(root => root === created.options.execution.boundary.cwd), false,
    "the expert cannot write the requesting workspace");
  assert.match(f.promptText(created), /Execute coding_worker \[coding-consultation\]/,
    "the expert is bound only to the bounded consultation text");
  assert.doesNotMatch(f.promptText(created), /Adaptive coding execution/);
  assert.match(f.promptText(created), /Question: which option keeps the wire format stable\?/);
  assert.match(f.promptText(created), /Expected conclusion: the option to implement and its compatibility rule\./);

  // The same question is never dispatched to a second expert.
  summary = await action({ action: "status" });
  assert.equal(summary.tasks.find(item => item.task === "T001").consults.length, 1);
  assert.equal(f.calls.filter(call => call.options?.model === "sup-model").length, 1);
});

test("the expert conclusion returns to the same worker, which still owns the result", async t => {
  const { f, action, attempt } = await dispatched(t, { strategy: "adaptive", report: base => CONSULT_REPORT(consultResult(base)) });
  let summary = await action({ action: "status" });
  const consult = summary.tasks.find(item => item.task === "T001").consults[0];
  const answerTurnId = f.facts.get(consult.id).turnId;
  await f.run(async () => { f.finish(consult.id, "Use the versioned envelope and keep the legacy reader."); });
  summary = await action({ action: "status" });
  const task = summary.tasks.find(item => item.task === "T001");
  assert.equal(task.consults[0].state, "delivered");
  assert.equal(task.consults[0].answerTurnId, answerTurnId, "the delivered conclusion is bound to the expert's turn");
  // The expert's report is acknowledged, so the consultation can be closed and
  // never outlives the task that asked for it.
  assert.equal((await f.run(async () => (await f.workers.get("parent", consult.id)).reports[0])).acknowledgedAt !== undefined, true);
  await f.run(() => f.workers.closeWorker("parent", consult.id, true, true));
  assert.equal(f.store.read().nativeChildren[consult.id].closed, true);
  assert.equal(task.state, "running", "the original worker continues; the expert never accepts the task");
  assert.equal(task.tier, "def", "the requesting worker keeps its own configuration");
  const returned = f.calls.filter(call => call.delivery === "queue" && call.content[0].text.includes("Consultation conclusion:"));
  assert.equal(returned.length, 1);
  assert.equal(returned[0].id, attempt.workerId, "the conclusion returns to the requesting execution");
  assert.match(returned[0].content[0].text, /Use the versioned envelope and keep the legacy reader\./);
  assert.match(returned[0].content[0].text, /Advice is not acceptance/);
  assert.equal(f.facts.get(attempt.workerId).turnId, task.turnId, "the worker's new turn is the returned conclusion");
});

test("a consultation survives a restart and a revised contract makes its result historical", async t => {
  const { f, action, attempt } = await dispatched(t, { strategy: "adaptive", report: base => CONSULT_REPORT(consultResult(base)) });
  let summary = await action({ action: "status" });
  const consult = summary.tasks.find(item => item.task === "T001").consults[0];

  // The association, the question and the resource fact survive a Host restart.
  const reloaded = new WorkflowStore(f.store.stateDir).read().runs[0].attempts[0];
  assert.deepEqual(reloaded.consults.map(entry => ({ id: entry.id, state: entry.state, question: entry.question, revision: entry.contractRevision })),
    [{ id: consult.id, state: "running", question: consult.question, revision: 1 }]);

  // The contract is revised while the expert is still working.
  const stored = f.store.read().runs[0].attempts[0];
  stored.task.revision = 2;
  f.store.save();
  await f.run(async () => { f.finish(consult.id, "Use the versioned envelope."); });
  summary = await action({ action: "status" });
  const task = summary.tasks.find(item => item.task === "T001");
  assert.equal(task.consults[0].state, "delivered");
  const returned = f.calls.filter(call => call.delivery === "queue" && call.content[0].text.includes("Consultation conclusion:")).at(-1);
  assert.match(returned.content[0].text, /The task contract was revised after this question was asked/,
    "a stale conclusion is handed back as historical evidence, not as authority");
  assert.ok(attempt.workerId);
});

test("a consultation outside its authorized phases is refused, not dispatched", async t => {
  const { f, action } = await dispatched(t, { strategy: "economy", report: base => CONSULT_REPORT(consultResult(base)) });
  const summary = await action({ action: "status" });
  const task = summary.tasks.find(item => item.task === "T001");
  assert.equal(task.consults, undefined);
  assert.equal(task.control.signal, "consult");
  assert.match(task.control.reason, /consult is not authorized for independent phase main/);
  assert.equal(f.calls.some(call => call.options?.model === "sup-model"), false, "no expert child is created");
});

const CROSS_PROVIDER = { ...DISTINCT, def_coding_worker: { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "high" } };

test("a cross-provider handoff without a fact projector is refused instead of dropping history", async t => {
  const { f, action } = await dispatched(t, { roles: CROSS_PROVIDER });
  const summary = await action({ action: "status" });
  const task = summary.tasks.find(item => item.task === "T001");
  assert.equal(f.calls.length, 1, "no successor child is created without the fact import");
  assert.equal(task.handoff, undefined);
  assert.equal(task.tier, "sup", "the worker keeps its opening configuration");
  assert.match(task.control.reason, /cross-provider continuation to deepseek-official needs the installed provider package's sourced execution-fact projector/);
});

test("a cross-provider handoff starts a sibling successor with the sourced facts", async t => {
  const imported = [
    "[source: codex thread=th1 turn=t1 item=i1] command: pnpm test (exit 0)",
    "[source: codex thread=th1 turn=t1 item=i2] file change: src/a.ts (update)",
  ];
  const { f, action, attempt } = await dispatched(t, { roles: CROSS_PROVIDER, facts: () => imported });
  const summary = await action({ action: "status" });
  const task = summary.tasks.find(item => item.task === "T001");
  const handoff = task.handoff;
  assert.equal(handoff.targetTier, "def");
  assert.equal(task.tier, "def");
  assert.notEqual(handoff.toWorker, attempt.workerId);
  assert.equal(f.handoffCalls.length, 0, "a cross-provider continuation does not share the Codex thread");
  assert.equal(handoff.threadId, undefined, "no native thread binding is recorded");
  assert.match(handoff.prompt, /does not share the previous provider's native thread; the executed facts below are the imported history/);
  assert.match(handoff.prompt, /Executed facts imported from the previous adapter \(already performed; do not re-run them\):/);
  assert.match(handoff.prompt, /\[source: codex thread=th1 turn=t1 item=i1\] command: pnpm test \(exit 0\)/);
  assert.match(handoff.prompt, /Long native output was shortened and remains addressable/);
  assert.match(handoff.prompt, /Do not hand off again/);

  const created = f.calls.find(call => call.id === handoff.toWorker);
  assert.equal(created.options.provider, "deepseek-official", "the successor runs under the target provider");
  assert.equal(created.options.model, "deepseek-flash");
  assert.equal(f.facts.get(handoff.toWorker).threadId, `thread-${handoff.toWorker}`, "the successor owns no Codex thread");

  // A projector that recorded nothing says so rather than implying empty history.
  const bare = await dispatched(t, { roles: CROSS_PROVIDER, facts: () => [] });
  const bareTask = (await bare.action({ action: "status" })).tasks.find(item => item.task === "T001");
  assert.match(bareTask.handoff.prompt, /No executed facts were recorded before the switch/);
});

test("turns on a successor adapter are read from the DSH session, so completion never stalls", async t => {
  const rows = new Map();
  const { f, action, base, attempt } = await (async () => {
    const { repo, generation, base } = project(t);
    const f = fixture(t, { cwd: repo, roles: CROSS_PROVIDER, facts: () => ["[source: codex thread=th1 turn=t1 item=i1] command: pnpm test (exit 0)"],
      sessionEvents: id => rows.get(id) ?? [] });
    f.store.selectStrategy("parent", "bootstrap");
    const workflow = new Workflow(f.workers, "/skills/codex-workflow");
    const action = input => f.run(() => workflow.execute("parent", input));
    await action({ action: "adopt", generation });
    await action({ action: "dispatch", task: "T001" });
    const attempt = (await action({ action: "status" })).tasks[0];
    await f.run(async () => { f.finish(attempt.workerId, HANDOFF_REPORT); });
    return { f, action, base, attempt };
  })();
  const toWorker = (await action({ action: "status" })).tasks.find(item => item.task === "T001").handoff.toWorker;
  assert.equal((await action({ action: "status" })).tasks.find(item => item.task === "T001").tier, "def",
    "the execution continues on the other adapter");

  // The successor still owns its own DSH session; only the recording adapter changed.
  rows.set(toWorker, []);
  let worker = await f.run(() => f.workers.get("parent", toWorker));
  assert.equal(worker.state, "running", "the new adapter's turn is in flight, not unknown");
  assert.deepEqual(worker.reports, [], "the old adapter's reports do not describe the new one's turns");

  const report = `- Task: T001\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${base}\n- Outcome: complete\n`;
  rows.set(toWorker, [
    { type: "turn/start", seq: 1, time: 1, data: { turn: 1 } },
    { type: "assistant/message", seq: 2, time: 2, data: { turn: 1, step: 1, message: { role: "assistant", id: "m1", content: [{ type: "text", text: report }] } } },
    { type: "turn/end", seq: 3, time: 3, data: { turn: 1, reason: { kind: "completed" } } },
  ]);
  // The child finished its turn: the live agent is gone and the session log is
  // the only record of what it ran.
  f.ctx.agents.delete(toWorker);
  worker = await f.run(() => f.workers.get("parent", toWorker));
  assert.equal(worker.state, "idle", "the session's closed turn ends the execution");
  assert.equal(worker.turnId, "dsh-1", "turn identity comes from the session log");
  assert.equal(worker.reports.length, 1);
  assert.equal(worker.reports[0].status, "completed");
  assert.equal(worker.reports[0].result, report);

  const recorded = (await action({ action: "record-result", task: "T001" })).tasks.find(item => item.task === "T001");
  assert.equal(recorded.outcome, "complete", "the result check reads the new adapter's own report");
  assert.equal(recorded.state, "candidate");
  assert.equal(recorded.activeWorker, toWorker, "the successor owns the recorded candidate");

  // A failed turn on the new adapter reports failure rather than stalling.
  rows.get(toWorker).push(
    { type: "turn/start", seq: 4, time: 4, data: { turn: 2 } },
    { type: "turn/end", seq: 5, time: 5, data: { turn: 2, reason: { kind: "error", error: { message: "adapter failed", code: "UNKNOWN" } } } },
  );
  const failed = await f.run(() => f.workers.get("parent", toWorker));
  assert.equal(failed.reports.at(-1).status, "failed");
  assert.ok(attempt.workerId);
});

test("a successor whose session is no longer live still confirms its handover", async t => {
  const rows = new Map();
  const { repo, generation, base } = project(t);
  const f = fixture(t, { cwd: repo, roles: CROSS_PROVIDER, facts: () => ["[source: codex thread=th1 turn=t1 item=i1] command: pnpm test (exit 0)"],
    sessionEvents: id => rows.get(id) ?? [] });
  f.store.selectStrategy("parent", "bootstrap");
  const workflow = new Workflow(f.workers, "/skills/codex-workflow");
  const action = input => f.run(() => workflow.execute("parent", input));
  await action({ action: "adopt", generation });
  await action({ action: "dispatch", task: "T001" });
  const opening = (await action({ action: "status" })).tasks[0];
  await f.run(async () => { f.finish(opening.workerId, HANDOFF_REPORT); });
  const handoff = (await action({ action: "status" })).tasks.find(item => item.task === "T001").handoff;
  assert.equal(handoff.status, "started");

  // The successor ran its turn on the other adapter; its agent and its live
  // session are gone, so only the persisted log records what it did.
  const report = `- Task: T001\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${base}\n- Outcome: complete\n`;
  rows.set(handoff.toWorker, [
    { type: "turn/start", seq: 1, time: 1, data: { turn: 1 } },
    { type: "assistant/message", seq: 2, time: 2, data: { turn: 1, step: 1, message: { role: "assistant", id: "m1", content: [{ type: "text", text: report }] } } },
    { type: "turn/end", seq: 3, time: 3, data: { turn: 1, reason: { kind: "completed" } } },
  ]);
  f.ctx.agents.delete(handoff.toWorker);
  f.ctx.sessions.delete(handoff.toWorker);

  const worker = await f.run(() => f.workers.get("parent", handoff.toWorker));
  assert.equal(worker.state, "idle", "a finished successor never reads as unknown");
  assert.equal(worker.turnId, "dsh-1", "the persisted log answers once the live session is gone");
  assert.equal(worker.reports.length, 1);

  const confirmed = (await action({ action: "status" })).tasks.find(item => item.task === "T001");
  assert.equal(confirmed.handoff.status, "confirmed", "the successor's own turn confirms the handover");
  assert.equal(confirmed.activeWorker, handoff.toWorker, "the confirmed successor owns the task");
});
