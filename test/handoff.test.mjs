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
 * Boot one dispatched bootstrap attempt with an injected route adapter. The
 * adapter records the continuation and moves the child's native facts to the
 * target configuration, standing in for the DSH subagent package.
 */
async function dispatched(t, { strategy = "bootstrap", routeAdapter = true, report = HANDOFF_REPORT } = {}) {
  const { repo, generation, base } = project(t);
  const deliveries = [];
  let facts;
  const adapter = routeAdapter ? async (_runtime, _parent, childId, content, _source, _signal, route) => {
    deliveries.push({ childId: String(childId), text: content[0].text, route });
    const row = facts.get(String(childId));
    row.model = route.model; row.reasoningEffort = route.reasoningEffort; row.state = "running";
    row.number += 1; row.turnId = `${String(childId)}:${row.number}`;
    return `handoff-message-${deliveries.length}`;
  } : undefined;
  const f = fixture(t, { cwd: repo, roles: DISTINCT, routeAdapter: adapter });
  facts = f.facts;
  f.store.selectStrategy("parent", strategy);
  const workflow = new Workflow(f.workers, "/skills/codex-workflow");
  const action = input => f.run(() => workflow.execute("parent", input));
  await action({ action: "adopt", generation });
  await action({ action: "dispatch", task: "T001" });
  const summary = await action({ action: "status" });
  const attempt = summary.tasks[0];
  await f.run(async () => { f.finish(attempt.workerId, typeof report === "function" ? report(base) : report); });
  return { f, action, attempt, deliveries, base, summary };
}

test("a bootstrap opening report hands the same worker to the def configuration", async t => {
  const { f, action, attempt, deliveries } = await dispatched(t);
  let summary = await action({ action: "status" });
  assert.equal(deliveries.length, 1, "the Host delivers the continuation once");
  assert.deepEqual(deliveries[0].route, { provider: "codex", model: "def-model", reasoningEffort: "medium" });
  assert.match(deliveries[0].text, /same coding_worker/);
  assert.match(deliveries[0].text, /Remaining work:\nfinish the remaining tests/);
  assert.equal(deliveries[0].childId, attempt.workerId, "the same worker continues");

  let task = summary.tasks.find(item => item.task === "T001");
  assert.equal(task.state, "running", "the handoff does not end the assignment");
  assert.equal(task.tier, "def");
  assert.equal(task.phase, "continuation");
  assert.equal(task.handoff.sourceTurnId, attempt.turnId, "the recorded source turn is the opening turn");
  assert.equal(task.handoff.messageId, "handoff-message-1");
  assert.match(task.handoff.prompt, /Continue as the same coding_worker/, "the bound continuation prompt is retained for audit");
  assert.equal(task.handoff.targetTurnId, undefined, "the target turn is recorded only from native facts");
  assert.equal(task.handoff.requestId, `${attempt.workerId}:handoff:${task.handoff.sourceTurnId}`);

  // Repeated observation reuses the recorded continuation instead of a second
  // one, and confirms the turn the switched execution actually ran.
  summary = await action({ action: "status" });
  assert.equal(deliveries.length, 1);
  const confirmed = summary.tasks.find(item => item.task === "T001").handoff;
  assert.equal(confirmed.requestId, task.handoff.requestId);
  assert.equal(confirmed.targetTurnId, f.facts.get(attempt.workerId).turnId, "the confirmed target turn comes from native facts");

  // The handoff turn is not a candidate result: recording it returns the same
  // continuing attempt instead of failing the result contract.
  summary = await action({ action: "record-result", task: "T001" });
  const recorded = summary.tasks.find(item => item.task === "T001");
  assert.equal(recorded.state, "running");
  assert.equal(recorded.result, undefined);
  assert.equal(deliveries.length, 1);
  assert.deepEqual(f.store.read().nativeChildren[attempt.workerId].strategy, {
    requested: "bootstrap", effective: "bootstrap", tier: "def", phase: "continuation",
  });
});

test("native usage is attributed to the task and deduplicated by turn", async t => {
  const { f, action, attempt } = await dispatched(t);
  // The continuing configuration completes a further turn.
  const row = f.facts.get(attempt.workerId);
  row.number += 1; row.turnId = `${attempt.workerId}:${row.number}`;
  f.finish(attempt.workerId, "done");
  row.reports.at(-1).usage = { totalTokens: 0, inputTokens: 100, cachedInputTokens: 20, cacheWriteInputTokens: null, outputTokens: 5, reasoningOutputTokens: 2 };
  let summary = await action({ action: "status" });
  const first = summary.tasks.find(item => item.task === "T001").usage;
  assert.deepEqual(first, { totalTokens: 0, inputTokens: 100, cachedInputTokens: 20, cacheWriteInputTokens: 0, outputTokens: 5, reasoningOutputTokens: 2, calls: 2, unreported: 1 });
  summary = await action({ action: "status" });
  assert.deepEqual(summary.tasks.find(item => item.task === "T001").usage, first, "re-observing the same turns changes nothing");
  assert.deepEqual(summary.usage, first, "the run total sums its attempts");
  // A turn that reported no usage stays counted as unreported, never as zero.
  assert.equal(first.unreported, 1);
});

test("parent coordination usage is reported separately from task usage", async t => {
  const { f, action, attempt } = await dispatched(t);
  // The session object itself is the identity the Host checks, so its log is
  // attached in place rather than replaced.
  const parentSession = f.ctx.sessions.get("parent");
  parentSession.snapshotEvents = () => [
      { type: "assistant/message", seq: 1, time: 1, data: { turn: 1, step: 1, message: { role: "assistant", id: "m1", content: [] },
        usage: { inputTokens: 30, outputTokens: 7, cacheReadTokens: 5, totalTokens: 42 } } },
      { type: "assistant/message", seq: 2, time: 2, data: { turn: 2, step: 1, message: { role: "assistant", id: "m2", content: [] },
        usage: { inputTokens: 10, outputTokens: 2 } } },
  ];
  const summary = await action({ action: "status" });
  assert.deepEqual(summary.coordination,
    { totalTokens: 42, inputTokens: 40, cachedInputTokens: 5, cacheWriteInputTokens: 0, outputTokens: 9, reasoningOutputTokens: 0, calls: 2, unreported: 0 },
    "the parent's own requests are summed as coordination");
  assert.equal(summary.usage.calls, 1, "task usage counts only native child turns");
  assert.match(summary.cost, /no billing feed is configured/, "money is never fabricated from token counts");
  assert.ok(attempt.workerId);
});

test("a control report outside its authorized phase is recorded, not performed", async t => {
  const { action, deliveries, attempt } = await dispatched(t, { strategy: "adaptive" });
  const summary = await action({ action: "status" });
  assert.equal(deliveries.length, 0, "adaptive does not authorize a handoff");
  const task = summary.tasks.find(item => item.task === "T001");
  assert.equal(task.state, "running");
  assert.equal(task.tier, "def");
  assert.equal(task.handoff, undefined);
  assert.deepEqual(task.control, { turnId: attempt.turnId, signal: "handoff",
    reason: "execution control handoff is not authorized for adaptive phase main" });
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

  const created = f.calls.slice(before).find(call => call.options !== undefined);
  assert.equal(created.id, consult.id, "the expert runs under the recorded child identity");
  assert.equal(created.options.model, "sup-model", "the expert uses the Profile's sup configuration");
  assert.equal(created.options.execution.boundary.cwd, f.facts.get(attempt.workerId).cwd);
  assert.equal(created.options.execution.boundary.writableRoots.some(root => root === created.options.execution.boundary.cwd), false,
    "the expert cannot write the requesting workspace");
  assert.equal(created.options.execution.developerInstructions, "Execute coding_worker [coding-consultation]",
    "the expert is bound only to the bounded consultation text");
  assert.doesNotMatch(created.options.execution.developerInstructions, /Adaptive coding execution/);
  assert.match(created.prompt[0].text, /Question: which option keeps the wire format stable\?/);
  assert.match(created.prompt[0].text, /Expected conclusion: the option to implement and its compatibility rule\./);

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

/** Adopt, dispatch and hand off one bootstrap opening phase under the given configuration. */
async function crossProviderAttempt(t, { facts, sessionEvents } = {}) {
  const { repo, generation, base } = project(t);
  const deliveries = [];
  let factsReads = 0;
  const f = fixture(t, { cwd: repo, roles: CROSS_PROVIDER, facts, sessionEvents,
    routeAdapter: async (_runtime, _parent, _childId, content, _source, _signal, route) => {
      deliveries.push({ content: content[0].text, route });
      return "handoff-message";
    } });
  f.store.selectStrategy("parent", "bootstrap");
  const workflow = new Workflow(f.workers, "/skills/codex-workflow");
  const action = input => f.run(() => workflow.execute("parent", input));
  await action({ action: "adopt", generation });
  await action({ action: "dispatch", task: "T001" });
  const attempt = (await action({ action: "status" })).tasks[0];
  await f.run(async () => { f.finish(attempt.workerId, HANDOFF_REPORT); });
  const summary = await action({ action: "status" });
  return { f, action, base, deliveries, summary, attempt, factsReads };
}

test("a cross-provider handoff without a fact projector is refused instead of dropping history", async t => {
  const { deliveries, summary } = await crossProviderAttempt(t);
  const task = summary.tasks.find(item => item.task === "T001");
  assert.equal(deliveries.length, 0, "no continuation is delivered without the fact import");
  assert.equal(task.handoff, undefined);
  assert.equal(task.tier, "sup", "the worker keeps its opening configuration");
  assert.match(task.control.reason, /cross-provider continuation to deepseek-official needs the installed provider package's sourced execution-fact projector/);
});

test("a cross-provider handoff carries the sourced executed facts to the new adapter", async t => {
  const facts = [
    "[source: codex thread=th1 turn=t1 item=i1] command: pnpm test (exit 0)",
    "[source: codex thread=th1 turn=t1 item=i2] file change: src/a.ts (update)",
  ];
  const { deliveries, summary, attempt } = await crossProviderAttempt(t, { facts: () => facts });
  const task = summary.tasks.find(item => item.task === "T001");
  assert.equal(task.handoff.target, "def");
  assert.equal(task.tier, "def");
  assert.equal(deliveries.length, 1);
  assert.deepEqual(deliveries[0].route, { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "high" });
  assert.match(deliveries[0].content, /Executed facts imported from the previous adapter \(already performed; do not re-run them\):/);
  assert.match(deliveries[0].content, /\[source: codex thread=th1 turn=t1 item=i1\] command: pnpm test \(exit 0\)/);
  assert.match(deliveries[0].content, /Long native output was shortened and remains addressable/);
  assert.match(deliveries[0].content, /Do not hand off again/);

  // An adapter that recorded nothing says so rather than implying empty history.
  const bare = await crossProviderAttempt(t, { facts: () => [] });
  assert.match(bare.deliveries[0].content, /No executed facts were recorded before the switch/);
  assert.equal(bare.summary.tasks.find(item => item.task === "T001").tier, "def");
  assert.ok(attempt.workerId);
});

test("turns on the new adapter are read from the DSH session, so completion never stalls", async t => {
  const events = [];
  const { f, action, base, summary, attempt } = await crossProviderAttempt(t, {
    facts: () => ["[source: codex thread=th1 turn=t1 item=i1] command: pnpm test (exit 0)"],
  });
  assert.equal(summary.tasks.find(item => item.task === "T001").tier, "def", "the execution continues on the other adapter");
  // The child still owns its DSH session; only the recording adapter changed.
  f.ctx.sessions.set(attempt.workerId, { id: attempt.workerId, header: { id: attempt.workerId, parentSession: "parent" }, snapshotEvents: () => events });

  let worker = await f.run(() => f.workers.get("parent", attempt.workerId));
  assert.equal(worker.state, "running", "the switched turn is in flight, not unknown");
  assert.deepEqual(worker.reports, [], "the old adapter's reports do not describe the new one's turns");

  const report = `- Task: T001\n- Contract revision: 1\n- Attempt: 1\n- Input snapshot: ${base}\n- Candidate snapshot: ${base}\n- Outcome: complete\n`;
  events.push(
    { type: "turn/start", seq: 1, time: 1, data: { turn: 1 } },
    { type: "assistant/message", seq: 2, time: 2, data: { turn: 1, step: 1, message: { role: "assistant", id: "m1", content: [{ type: "text", text: report }] } } },
    { type: "turn/end", seq: 3, time: 3, data: { turn: 1, reason: { kind: "completed" } } },
  );
  worker = await f.run(() => f.workers.get("parent", attempt.workerId));
  assert.equal(worker.state, "idle", "the session's closed turn ends the execution");
  assert.equal(worker.turnId, "dsh-1", "turn identity comes from the session log");
  assert.equal(worker.reports.length, 1);
  assert.equal(worker.reports[0].status, "completed");
  assert.equal(worker.reports[0].result, report);

  const recorded = (await action({ action: "record-result", task: "T001" })).tasks.find(item => item.task === "T001");
  assert.equal(recorded.outcome, "complete", "the result check reads the new adapter's own report");
  assert.equal(recorded.state, "candidate");

  // A failed turn on the new adapter reports failure rather than stalling.
  events.push(
    { type: "turn/start", seq: 4, time: 4, data: { turn: 2 } },
    { type: "turn/end", seq: 5, time: 5, data: { turn: 2, reason: { kind: "error", error: { message: "adapter failed", code: "UNKNOWN" } } } },
  );
  const failed = await f.run(() => f.workers.get("parent", attempt.workerId));
  assert.equal(failed.reports.at(-1).status, "failed");
});

test("an unsupported package set reports the route instead of silently running the old configuration", async t => {
  const { action, deliveries } = await dispatched(t, { routeAdapter: false });
  const summary = await action({ action: "status" });
  assert.equal(deliveries.length, 0);
  assert.deepEqual(summary.routeSupport, { supported: false, reason: "the installed subagent package cannot change an execution route" });
  const task = summary.tasks.find(item => item.task === "T001");
  assert.equal(task.state, "running");
  assert.equal(task.handoff, undefined);
  assert.match(task.control.reason, /cannot change an execution route/);
});
