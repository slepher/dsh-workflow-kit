import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Context, Service } from "@deepseek-ai/cordis";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { defineTool } from "@deepseek-ai/dsh-tools";
import { apply, inject, WorkflowStore } from "../lib/index.js";

test("workflow host leaves the ordinary consumer untouched and activates managed status", async t => {
  const root = mkdtempSync(join(tmpdir(), "workflow-safety-host-"));
  const stateDir = join(root, "state");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry);

  let executionReads = 0, routes = 0;
  const handlers = new Map(), binds = [];
  class CodexExecution extends Service {
    constructor(scope) { super(scope, "codexExecution"); }
    async read() { executionReads++; return undefined; }
  }
  class CodexToolGate extends Service {
    constructor(scope) { super(scope, "codexToolGate"); }
    register(hook, handler) {
      assert.equal(handlers.has(hook), false, "one handler per hook");
      handlers.set(hook, handler);
      return () => handlers.delete(hook);
    }
    bind(sessionId, binding) { binds.push({ sessionId, binding }); }
  }
  class Subagents extends Service { constructor(scope) { super(scope, "subagents"); } }
  class Connection extends Service {
    channels = new Map();
    constructor(scope) { super(scope, "connection"); }
    get rpc() { return { handle: (channel, handler) => this.ctx.effect(() => { this.channels.set(channel, handler); return () => this.channels.delete(channel); }) }; }
  }
  class WebServer extends Service { constructor(scope) { super(scope, "webServer"); } register() { routes += 1; return () => { routes -= 1; }; } }
  class Sessions extends Service { values = new Map(); constructor(scope) { super(scope, "sessions"); } get(id) { return this.values.get(String(id)); } }
  await ctx.plugin(CodexExecution); await ctx.plugin(CodexToolGate); await ctx.plugin(Subagents); await ctx.plugin(Connection); await ctx.plugin(WebServer); await ctx.plugin(Sessions);
  let tools;
  await ctx.plugin({ inject: ["tools"], apply(scope) { tools = scope.tools; scope.tools.register(defineTool({
      name: "ordinary_sentinel", description: "ordinary tool sentinel", parameters: {},
      output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
      async execute() { return "ordinary-ok"; },
    })); } });
  await new Promise(resolve => setTimeout(resolve, 0));
  const scope = ctx.plugin(() => {});
  const agent = { id: "parent", ctx: scope.ctx, session: { id: "parent", header: { cwd: "/work" } }, status: "idle", followup() {} };
  ctx.agents.register(agent); ctx.sessions.values.set("parent", agent.session);

  const plugin = await ctx.plugin({ apply, inject }, { stateDir, workflowSkillDir: "/skills/codex-workflow" });
  await new Promise(resolve => setTimeout(resolve, 0));
  const ordinary = await tools.execute({ signal: new AbortController().signal, callId: "ordinary", name: "ordinary_sentinel", arguments: {}, agent });
  assert.equal(ordinary.isError, false); assert.equal(ordinary.content[0].text, "ordinary-ok");
  const managed = await tools.execute({ signal: new AbortController().signal, callId: "status", name: "codex_workflow", arguments: { action: "status" }, agent });
  assert.equal(managed.isError, false); assert.deepEqual(JSON.parse(managed.content[0].text), { workflowSkillDir: "/skills/codex-workflow", adopted: false });
  assert.equal(ctx.get("codexKit"), undefined, "native workflow needs no old kit service");
  assert.equal(executionReads, 0, "status without children does not query or start Codex");
  // A caller choosing a role must get the catalogue and the tool's own contract,
  // not the package source: this is what the provider-side surface cannot answer.
  const catalogue = await tools.execute({ signal: new AbortController().signal, callId: "roles", name: "codex_workflow", arguments: { action: "roles" }, agent });
  assert.equal(catalogue.isError, false);
  const roles = JSON.parse(catalogue.content[0].text);
  assert.equal(roles.some(role => role.name === "evidence_runner" && role.description.length > 0), true,
    "the role catalogue is readable before any generation is adopted");
  assert.match(tools.get("codex_workflow").description, /evidence_runner/,
    "the tool contract names the roles it can dispatch");
  assert.equal(tools.get("codex_workflow").parameters.properties.action.enum.includes("delegate"), true,
    "the contract also carries the direct-assignment action");
  assert.match(tools.get("codex_workflow").description, /assigns one bounded task to a role directly/);
  assert.equal(existsSync(join(stateDir, "orchestration.json")), false, "reading roles writes no orchestration state file");
  const missingParent = await tools.execute({ signal: new AbortController().signal, callId: "no-parent", name: "codex_workflow", arguments: { action: "status" } });
  assert.equal(missingParent.isError, true);
  assert.match(missingParent.content[0].text, /live parent agent/);
  assert.deepEqual([...ctx.connection.channels.keys()], [], "the browser profile channel is not registered through Connection's own fiber");
  assert.equal(routes, 1, "host registers the workflow browser profile route on the Web server");
  assert.equal(existsSync(join(stateDir, "orchestration.json")), false, "read-only status writes no orchestration state file");

  await plugin.dispose();
  assert.equal(routes, 0);
  assert.equal(handlers.size, 0, "unloading the workflow Host releases the provider gate handler");
  assert.ok(ctx.get("codexExecution"), "workflow unload retains the independent provider");
  const afterUnload = await tools.execute({ signal: new AbortController().signal, callId: "ordinary-after", name: "ordinary_sentinel", arguments: {}, agent });
  assert.equal(afterUnload.isError, false); assert.equal(afterUnload.content[0].text, "ordinary-ok");
});
