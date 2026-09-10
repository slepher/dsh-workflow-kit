import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Context, Service } from "@deepseek-ai/cordis";
import { Readable } from "node:stream";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { apply, inject } from "../lib/index.js";
import { Backend } from "./backend.mjs";

test("headless host consumes the shared codexKit backend and registers both tools", async t => {
  const stateDir = mkdtempSync(join(tmpdir(), "workflow-host-")); t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry);
  const backend = new Backend();
  class CodexKit extends Service { constructor(scope) { super(scope, "codexKit"); this.backend = backend; } }
  await ctx.plugin(CodexKit);
  const scope = ctx.plugin(() => {}), agent = { id: "parent", ctx: scope.ctx, session: { id: "parent", header: { cwd: "/work" } }, status: "idle", followup() {} };
  ctx.agents.register(agent);
  const plugin = await ctx.plugin({ apply, inject }, { stateDir, workflowSkillDir: "/skills/codex-workflow" });
  const list = await ctx.tools.execute({ signal: new AbortController().signal, callId: "workers", name: "codex_workers", arguments: { action: "list" }, agent });
  assert.equal(list.isError, false); assert.equal(list.content[0].text, "[]");
  const status = await ctx.tools.execute({ signal: new AbortController().signal, callId: "workflow", name: "codex_workflow", arguments: { action: "status" }, agent });
  assert.equal(status.isError, false); assert.equal(JSON.parse(status.content[0].text).adopted, false);
  await plugin.dispose();
  assert.equal(backend.guards.size, 0, "workflow unload removes only its guard");
});

test("registers authenticated worker RPC and event transport", async t => {
  const stateDir = mkdtempSync(join(tmpdir(), "workflow-transport-")); t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry);
  const backend = new Backend();
  class CodexKit extends Service { constructor(scope) { super(scope, "codexKit"); this.backend = backend; } }
  class Connection extends Service { rejection = undefined; constructor(scope) { super(scope, "connection"); } requestRejection() { return this.rejection; } }
  class WebServer extends Service { routes = []; constructor(scope) { super(scope, "webServer"); } register(route) { this.routes.push(route); return () => this.routes.splice(this.routes.indexOf(route), 1); } }
  await ctx.plugin(CodexKit); await ctx.plugin(Connection); await ctx.plugin(WebServer);
  const scope = ctx.plugin(() => {}), agent = { id: "parent", ctx: scope.ctx, session: { id: "parent", header: { cwd: "/work" } }, status: "idle", followup() {} };
  ctx.agents.register(agent);
  const plugin = await ctx.plugin({ apply, inject }, { stateDir, workflowSkillDir: "/skills/codex-workflow" });
  const route = ctx.webServer.routes.find(candidate => candidate.path === "/codex-workers");
  assert.ok(route);
  const envelope = JSON.stringify({ type: "client-request", rpcId: "1", method: "action", payload: { sessionId: "parent", input: { action: "list" } } });
  const req = Readable.from([envelope]); Object.assign(req, { method: "POST", url: "/codex-workers/action" });
  const response = responseCapture(); await route.handler(req, response);
  assert.equal(response.status, 200); assert.deepEqual(JSON.parse(response.body).result.value, []);
  const create = JSON.stringify({ type: "client-request", rpcId: "2", method: "action", payload: { sessionId: "parent", input: { action: "create", name: "A" } } });
  const created = responseCapture(); await route.handler(Object.assign(Readable.from([create]), { method: "POST", url: "/codex-workers/action" }), created);
  const worker = JSON.parse(created.body).result.value;
  const events = responseCapture(); await route.handler(Object.assign(Readable.from([]), { method: "GET", url: `/codex-workers/events?sessionId=parent&workerId=${worker.id}` }), events);
  assert.equal(events.status, 200); assert.match(events.body, /event: ready/); events.close?.();
  ctx.connection.rejection = 401;
  const denied = responseCapture(); await route.handler(Object.assign(Readable.from([]), { method: "POST", url: "/codex-workers/action" }), denied);
  assert.equal(denied.status, 401);
  await plugin.dispose();
  assert.equal(ctx.webServer.routes.length, 0);
});

function responseCapture() {
  return {
    status: 0, body: "", writeHead(status) { this.status = status; },
    write(value) { this.body += value; return true; }, end(value = "") { this.body += value; },
    once(event, listener) { if (event === "close") this.close = listener; },
  };
}
