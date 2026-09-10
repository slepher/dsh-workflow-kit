import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Context, Service } from "@deepseek-ai/cordis";
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
