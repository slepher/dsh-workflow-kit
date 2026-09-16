import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Context, Service } from "@deepseek-ai/cordis";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { defineTool } from "@deepseek-ai/dsh-tools";
import { apply, inject, WorkflowStore } from "../lib/index.js";
import { buildGateArgs, gateBinding } from "../lib/gate.js";

/**
 * One Host with a real tools registry, a real guard and synthetic tools that
 * count their own executions.
 *
 * This is the DSH-native half of the gate's acceptance: a denial has to happen
 * before the tool body runs, which only a real registry can demonstrate.
 */
async function host(t, options = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "workflow-native-gate-")));
  // The manager Session's own workspace; a Session that adopted the generation
  // while running somewhere else is still an ordinary configuration.
  const managerCwd = options.managerCwd ?? root;
  const lane = join(root, "agentwork", "goal", ".lanes", "lane-01");
  const generation = join(root, "agentwork", "goal", "generation-1");
  const artifacts = join(generation, ".artifacts", "T1-A1", "worker");
  const source = join(lane, "src");
  for (const path of [source, join(generation, "results"), artifacts]) mkdirSync(path, { recursive: true });
  writeFileSync(join(source, "a.ts"), "export const a = 1\n");
  writeFileSync(join(source, "b.ts"), "export const b = 1\n");
  const stateDir = join(root, "state");
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const codingGate = gateBinding("coding_worker", buildGateArgs({ cwd: lane, lane, productWrites: [join(source, "a.ts")], auxiliaryWrites: [artifacts] }));
  const seed = new WorkflowStore(stateDir);
  const record = (id, gate) => ({ id, parentSessionId: "parent", name: id, role: "coding_worker", profile: "a",
    execution: { provider: "codex", model: "m", reasoningEffort: "high", developerInstructions: "i" },
    boundary: { cwd: lane, writableRoots: [lane], network: "disabled", ports: {} }, dispatches: [], acceptance: {},
    ...(gate === undefined ? {} : { gate }) });
  seed.putNativeChild(record("child", codingGate));
  // The same assignment, on a child whose Session reports its parent's workspace
  // instead of the lane — what the stock subagent runtime gives every native
  // child, and what the shipped Codex path hides by starting the thread in the lane.
  seed.putNativeChild(record("lane-worker", codingGate));
  seed.putNativeChild(record("legacy", undefined));
  seed.read().runs.push({ id: "run", parent: "parent", plan: { generation, revision: 1, repository: root,
    target: "refs/heads/main", base: "HEAD", delivery: "working-tree", text: "", policy: { initial: 1, max: 1, expand: false, bases: [] }, tasks: {} },
    lanes: [], attempts: [] });
  seed.save();

  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry);
  const handlers = new Map(), binds = [];
  class CodexExecution extends Service { constructor(scope) { super(scope, "codexExecution"); } async read() { return undefined; } }
  class CodexToolGate extends Service {
    constructor(scope) { super(scope, "codexToolGate"); }
    register(hook, handler) { assert.equal(handlers.has(hook), false, "one handler per hook"); handlers.set(hook, handler); return () => handlers.delete(hook); }
    bind(sessionId, binding) { binds.push({ sessionId, binding, started: false }); }
  }
  class Subagents extends Service { constructor(scope) { super(scope, "subagents"); } }
  class Connection extends Service { channels = new Map(); constructor(scope) { super(scope, "connection"); }
    get rpc() { return { handle: (channel, handler) => this.ctx.effect(() => { this.channels.set(channel, handler); return () => this.channels.delete(channel); }) }; } }
  class WebServer extends Service { constructor(scope) { super(scope, "webServer"); } register() { return () => {}; } }
  class Sessions extends Service { values = new Map(); constructor(scope) { super(scope, "sessions"); } get(id) { return this.values.get(String(id)); } }
  for (const plugin of [CodexExecution, CodexToolGate, Subagents, Connection, WebServer, Sessions]) await ctx.plugin(plugin);

  const executions = { write: 0, edit: 0, bash: 0, subagent: 0, sentinel: 0 };
  let tools;
  await ctx.plugin({ inject: ["tools"], apply(scope) {
    tools = scope.tools;
    const counted = (name, parameters) => scope.tools.register(defineTool({
      name, description: `${name} sentinel`, parameters,
      output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
      async execute() { executions[name] += 1; return `${name}-ok`; },
    }));
    counted("write", { file_path: { type: "string" }, content: { type: "string" } });
    counted("edit", { file_path: { type: "string" } });
    counted("bash", { command: { type: "string" } });
    counted("subagent", { text: { type: "string" } });
    counted("sentinel", {});
  } });
  await new Promise(resolve => setTimeout(resolve, 0));

  const scope = ctx.plugin(() => {});
  const agent = (id, cwd, parentSession) => ({ id, ctx: scope.ctx, session: { id, header: { cwd, ...(parentSession === undefined ? {} : { parentSession }) } }, status: "idle", followup() {} });
  const parent = agent("parent", managerCwd), child = agent("child", lane, "parent");
  const laneWorker = agent("lane-worker", root, "parent");
  const legacy = agent("legacy", lane, "parent"), stranger = agent("stranger", root);
  for (const value of [parent, child, laneWorker, legacy, stranger]) { ctx.agents.register(value); ctx.sessions.values.set(value.id, value.session); }

  const plugin = await ctx.plugin({ apply, inject }, { stateDir, workflowSkillDir: "/skills/codex-workflow" });
  await new Promise(resolve => setTimeout(resolve, 0));
  t.after(() => plugin.dispose());

  let call = 0;
  const run = (name, args, who) => tools.execute({ signal: new AbortController().signal, callId: `call-${++call}`, name, arguments: args, agent: who });
  return { root, lane, generation, source, stateDir, ctx, tools, run, executions, handlers, binds, plugin, parent, child, laneWorker, legacy, stranger };
}

test("a denied file write never reaches the tool body and an allowed one does", async t => {
  const h = await host(t);
  const allowed = await h.run("write", { file_path: join(h.source, "a.ts"), content: "x" }, h.child);
  assert.equal(allowed.isError, false, allowed.content[0].text);
  assert.equal(h.executions.write, 1);

  const denied = await h.run("write", { file_path: join(h.source, "b.ts"), content: "x" }, h.child);
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /workflow gate: write outside assigned paths/);
  assert.equal(h.executions.write, 1, "the denied write never executed");

  const artifacts = await h.run("edit", { file_path: join(h.generation, ".artifacts", "T1-A1", "worker", "note.md") }, h.child);
  assert.equal(artifacts.isError, false, artifacts.content[0].text);
  assert.equal(h.executions.edit, 1);
});

test("a registered child keeps its shell, and the manager is refused it", async t => {
  const h = await host(t);
  const worker = await h.run("bash", { command: "npm test" }, h.child);
  assert.equal(worker.isError, false, worker.content[0].text);
  assert.equal(h.executions.bash, 1);

  const manager = await h.run("bash", { command: "touch marker.txt" }, h.parent);
  assert.equal(manager.isError, true);
  assert.match(manager.content[0].text, /workflow gate: manager does not run bash/);
  assert.equal(h.executions.bash, 1, "the manager's shell never executed");
});

test("the manager may write its own generation summary and nothing else", async t => {
  const h = await host(t);
  const summary = await h.run("write", { file_path: join(h.generation, "summary.md"), content: "# summary" }, h.parent);
  assert.equal(summary.isError, false, summary.content[0].text);
  assert.equal(h.executions.write, 1);
  const elsewhere = await h.run("write", { file_path: join(h.source, "a.ts"), content: "x" }, h.parent);
  assert.equal(elsewhere.isError, true);
  assert.equal(h.executions.write, 1);
  // A scheduling entry point is refused for the manager too: otherwise it could
  // start a child this gate never registered.
  const fanOut = await h.run("subagent", { text: "go" }, h.parent);
  assert.equal(fanOut.isError, true);
  assert.match(fanOut.content[0].text, /workflow gate: subagent is the Host's lifecycle decision/);
  assert.equal(h.executions.subagent, 0);
  // A child is refused it as well.
  const childFanOut = await h.run("subagent", { text: "go" }, h.child);
  assert.equal(childFanOut.isError, true);
  assert.equal(h.executions.subagent, 0);
  // A tool this gate does not name is left to the rest of the pipeline.
  const unknown = await h.run("sentinel", {}, h.parent);
  assert.equal(unknown.isError, false, unknown.content[0].text);
});

test("the manager's generation summary is writable from wherever the Session was launched", async t => {
  const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "workflow-manager-cwd-")));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  const h = await host(t, { managerCwd: elsewhere });
  // The manager adopted the generation while running elsewhere; the grant on its
  // summary decides, and the summary is granted.
  const summary = await h.run("write", { file_path: join(h.generation, "summary.md"), content: "# summary" }, h.parent);
  assert.equal(summary.isError, false, summary.content[0].text);
  const other = await h.run("write", { file_path: join(h.generation, "plan.md"), content: "x" }, h.parent);
  assert.equal(other.isError, true);
  assert.match(other.content[0].text, /workflow gate: write outside assigned paths/);
});

test("a native lane worker is checked by its assigned paths, not by which directory it reports", async t => {
  const h = await host(t);
  // Its Session reports the repository; its assignment lives in the lane. The
  // authorized absolute path is authorized from there, through the real guard.
  const allowed = await h.run("write", { file_path: join(h.source, "a.ts"), content: "x" }, h.laneWorker);
  assert.equal(allowed.isError, false, allowed.content[0].text);
  assert.equal(h.executions.write, 1);
  // A relative path resolves against the directory the child really reports, so
  // it lands in the repository and is refused — the child uses the absolute
  // paths its contract carries, as the dispatch prompt already gives it.
  const relative = await h.run("edit", { file_path: "src/b.ts" }, h.laneWorker);
  assert.equal(relative.isError, true);
  assert.match(relative.content[0].text, /workflow gate: write outside assigned paths/);
  // The scope is unchanged: a neighbour in the same lane is still refused.
  const neighbour = await h.run("write", { file_path: join(h.source, "b.ts"), content: "x" }, h.laneWorker);
  assert.equal(neighbour.isError, true);
  assert.equal(h.executions.write, 1);
});

test("a Session with no binding, and a legacy record, keep their previous behaviour", async t => {
  const h = await host(t);
  for (const who of [h.legacy, h.stranger]) {
    const result = await h.run("write", { file_path: join(h.source, "b.ts"), content: "x" }, who);
    assert.equal(result.isError, false, `${who.id}: ${result.content[0].text}`);
  }
  assert.equal(h.executions.write, 2);
});

test("the guard is one of the pipeline's checks and is released on unload", async t => {
  const h = await host(t);
  const args = { file_path: join(h.source, "b.ts"), content: "x" };
  assert.equal((await h.run("write", args, h.child)).isError, true);
  assert.equal(h.executions.write, 0);
  await h.plugin.dispose();
  assert.equal(h.handlers.size, 0, "unloading releases the provider-side handler");
  const after = await h.run("write", args, h.child);
  assert.equal(after.isError, false, "with the guard unloaded the ordinary pipeline decides again");
  assert.equal(h.executions.write, 1);
});
