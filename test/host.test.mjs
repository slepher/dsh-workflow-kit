import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Context, Service } from "@deepseek-ai/cordis";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { defineTool } from "@deepseek-ai/dsh-tools";
import { CodexSessionBackend } from "dsh-codex-kit-backend";
import { executeWorkerAction } from "dsh-codex-kit-backend/host";
import { apply, inject } from "../lib/index.js";

test("workflow host leaves the ordinary consumer untouched and activates managed status", async t => {
  const root = mkdtempSync(join(tmpdir(), "workflow-safety-host-"));
  const stateDir = join(root, "state");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry);

  let provider, providerDisposed = 0, routes = 0;
  class CodexKit extends Service {
    constructor(scope) {
      super(scope, "codexKit");
      this.backend = { registerWorkflow(value) { provider = value; return { dispose() { providerDisposed += 1; } }; } };
    }
  }
  class Connection extends Service { constructor(scope) { super(scope, "connection"); } }
  class WebServer extends Service { constructor(scope) { super(scope, "webServer"); } register() { routes += 1; return () => { routes -= 1; }; } }
  class Sessions extends Service { values = new Map(); constructor(scope) { super(scope, "sessions"); } get(id) { return this.values.get(String(id)); } }
  await ctx.plugin(CodexKit); await ctx.plugin(Connection); await ctx.plugin(WebServer); await ctx.plugin(Sessions);
  let tools;
  await ctx.plugin({ inject: ["tools"], apply(scope) { tools = scope.tools; scope.tools.register(defineTool({
      name: "codex_workers", description: "ordinary backend sentinel", parameters: {},
      output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
      async execute() { return "ordinary-ok"; },
    })); } });
  await new Promise(resolve => setTimeout(resolve, 0));
  const scope = ctx.plugin(() => {});
  const agent = { id: "parent", ctx: scope.ctx, session: { id: "parent", header: { cwd: "/work" } }, status: "idle", followup() {} };
  ctx.agents.register(agent); ctx.sessions.values.set("parent", agent.session);

  const plugin = await ctx.plugin({ apply, inject }, { stateDir, workflowSkillDir: "/skills/codex-workflow" });
  await new Promise(resolve => setTimeout(resolve, 0));
  const ordinary = await tools.execute({ signal: new AbortController().signal, callId: "ordinary", name: "codex_workers", arguments: {}, agent });
  assert.equal(ordinary.isError, false); assert.equal(ordinary.content[0].text, "ordinary-ok");
  const managed = await tools.execute({ signal: new AbortController().signal, callId: "status", name: "codex_workflow", arguments: { action: "status" }, agent });
  assert.equal(managed.isError, false); assert.deepEqual(JSON.parse(managed.content[0].text), { workflowSkillDir: "/skills/codex-workflow", adopted: false });
  assert.equal(provider.resolveRole("evidence_runner").name, "evidence_runner");
  assert.equal(provider.listRoles().some(role => role.name === "evidence_runner"), true);
  assert.throws(() => provider.authorize(
    { nativeSessionId: "parent", source: "agent", parentAgent: { id: "parent", nativeSessionId: "parent" } },
    "unscoped", "create",
  ), /Workflow backend integration is not ready/, "managed mutations fail closed outside the exact workflow scope");
  assert.equal(routes, 0, "host does not register the legacy browser RPC/SSE route");
  assert.equal(existsSync(join(stateDir, "orchestration.json")), false, "read-only status writes no orchestration state file");

  await plugin.dispose();
  assert.equal(providerDisposed, 1, "host unload removes only its backend provider");
  const afterUnload = await tools.execute({ signal: new AbortController().signal, callId: "ordinary-after", name: "codex_workers", arguments: {}, agent });
  assert.equal(afterUnload.isError, false); assert.equal(afterUnload.content[0].text, "ordinary-ok");
});

test("real provider creates an ordinary evidence_runner through the backend role path", async t => {
  const stateDir = mkdtempSync(join(tmpdir(), "workflow-provider-backend-"));
  const cwd = mkdtempSync(join(tmpdir(), "workflow-provider-cwd-"));
  t.after(() => { rmSync(stateDir, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true }); });
  class Server extends EventEmitter {
    calls = [];
    async connect() {}
    async request(method, params) {
      this.calls.push({ method, params });
      if (method === "thread/start") return { thread: { id: "thread-evidence" }, model: params.model, reasoningEffort: params.config.model_reasoning_effort };
      return {};
    }
    respond() {} reject() {} async close() {}
  }
  const server = new Server(), backend = new CodexSessionBackend(stateDir, () => server);
  t.after(() => backend.close());
  let dispose;
  const ctx = {
    codexKit: { backend }, tools: { register() {} },
    agents: { get: id => id === "parent" ? agent : undefined },
    effect(factory) { dispose = factory(); },
  };
  const session = { id: "parent", header: { cwd } }, agent = { id: "parent", session };
  apply(ctx, { stateDir, workflowSkillDir: "/skills/codex-workflow" });
  const caller = { nativeSessionId: "parent", source: "agent", parentAgent: { id: "parent", nativeSessionId: "parent" } };
  const worker = await executeWorkerAction(backend, caller, cwd, { action: "create", workerId: "evidence", name: "Evidence", role: "evidence_runner" });
  assert.equal(worker.role, "evidence_runner"); assert.equal(worker.managedBy, undefined);
  assert.equal(worker.model, "gpt-5.6-luna"); assert.equal(worker.effort, "medium");
  assert.match(server.calls[0].params.developerInstructions, /evidence/);
  dispose();
  await assert.rejects(executeWorkerAction(backend, caller, cwd, { action: "roles" }), /Workflow role provider is unavailable/);
});
