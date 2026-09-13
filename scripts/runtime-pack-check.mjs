import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function verifyInstalledRuntime(directory, { workflow }) {
  const require = createRequire(join(directory, "runtime.cjs"));
  const load = name => import(pathToFileURL(require.resolve(name)));
  const { Context } = await load("@deepseek-ai/cordis");
  const { default: LlmRuntime } = await load("@deepseek-ai/dsh-llm");
  const provider = await load("dsh-codex-app-provider");
  const stateDir = mkdtempSync(join(tmpdir(), "dsh-pack-runtime-"));
  const ctx = new Context();
  try {
    new LlmRuntime(ctx);
    const { default: AgentRegistry } = await load("@deepseek-ai/dsh-agent");
    ctx.plugin(AgentRegistry);
    const sessions = new Map();
    ctx.provide("sessions", { get: id => sessions.get(String(id)) });
    const mounted = ctx.plugin(provider, { stateDir, command: "pack-check-codex-must-not-run" });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ctx.llm.listProviders().filter(value => value.id === "codex").length, 1);
    assert.equal(await ctx.codexExecution.read("absent"), undefined);
    assert.equal(ctx.get("codexKit"), undefined);
    assert.equal(existsSync(join(stateDir, "owner.lock")), true);
    if (workflow) {
      const { default: ToolRuntime } = await load("@deepseek-ai/dsh-tools");
      const { default: SystemPrompt } = await load("@deepseek-ai/dsh-system-prompt");
      ctx.plugin(ToolRuntime); ctx.plugin(SystemPrompt);
      ctx.provide("subagents", {});
      const workflowEntry = await load("dsh-workflow-kit");
      const managed = ctx.plugin(workflowEntry, { stateDir: join(stateDir, "workflow") });
      await new Promise(resolve => setImmediate(resolve));
      const agent = { id: "pack-parent", ctx, session: { id: "pack-parent", header: { cwd: stateDir } }, status: "idle" };
      ctx.agents.register(agent); sessions.set(agent.id, agent.session);
      const result = await ctx.tools.execute({ name: "codex_workflow", arguments: { action: "status" }, callId: "pack-status", agent, signal: new AbortController().signal });
      assert.equal(result.isError, false, JSON.stringify(result));
      assert.equal(JSON.parse(result.content[0].text).adopted, false);
      await managed.dispose();
      assert.ok(ctx.codexExecution);
      assert.equal(ctx.llm.listProviders().filter(value => value.id === "codex").length, 1);
    }
    await mounted.dispose();
    assert.equal(ctx.llm.listProviders().some(value => value.id === "codex"), false);
    assert.equal(existsSync(join(stateDir, "owner.lock")), false);
  } finally {
    await ctx.fiber.dispose();
    rmSync(stateDir, { recursive: true, force: true });
  }
}
