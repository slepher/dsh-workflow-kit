import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Context, Service } from "@deepseek-ai/cordis";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { apply, Config, inject } from "../lib/index.js";

/** Settings stub: the page policy the plugin registers for its own entry. */
class Settings extends Service {
  configured = undefined;
  constructor(scope) { super(scope, "settings"); }
  configure(presentation, owner) { this.configured = { presentation, owner }; return () => {}; }
}

/** Minimal carriers the Host plugin registers against. */
class CodexExecution extends Service { constructor(scope) { super(scope, "codexExecution"); } async read() { return undefined; } }
class CodexToolGate extends Service {
  constructor(scope) { super(scope, "codexToolGate"); }
  register() { return () => {}; }
  bind() {}
}
class Subagents extends Service { constructor(scope) { super(scope, "subagents"); } }
class Sessions extends Service {
  values = new Map();
  constructor(scope) { super(scope, "sessions"); }
  get(id) { return this.values.get(String(id)); }
}
class Connection extends Service {
  constructor(scope) { super(scope, "connection"); }
  requestRejection() { return undefined; }
}
class WebServer extends Service {
  route = undefined;
  constructor(scope) { super(scope, "webServer"); }
  register(route) { this.route = route; return () => { this.route = undefined; }; }
}

/** Mount the real Host plugin over one stored configuration section. */
async function host(t, stored) {
  const root = mkdtempSync(join(tmpdir(), "workflow-host-strategy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry);
  await ctx.plugin(CodexExecution); await ctx.plugin(CodexToolGate); await ctx.plugin(Subagents); await ctx.plugin(Sessions);
  await ctx.plugin(Connection); await ctx.plugin(WebServer);
  await ctx.plugin({ apply: scope => { new Settings(scope); }, inject: [] });
  // The Loader hands the plugin a config resolved from its own `Config` schema;
  // building it here is what turns the stored fields into volatile references.
  await ctx.plugin({ apply, inject }, new Config({
    ...stored, stateDir: join(root, "state"), workflowSkillDir: "/skills/codex-workflow", defaultProfile: "gpt-workflow",
  }));
  await new Promise(resolve => setTimeout(resolve, 0));
  const session = { id: "parent", header: { id: "parent", cwd: "/work" } };
  ctx.sessions.values.set("parent", session);
  const webServer = ctx.get("webServer");
  const call = async (method, payload) => {
    const body = JSON.stringify({ type: "client-request", rpcId: "test", method, payload });
    const captured = { body: "" };
    await webServer.route.handler(
      // A server `IncomingMessage` carries its own `signal` from Node 24.14, and
      // on the real carrier it is already aborted once the body has been
      // consumed; the channel owns its cancellation instead of reading it.
      { method: "POST", url: `/workflow/${method}`, headers: { "content-type": "application/json", host: "127.0.0.1:3080" }, signal: AbortSignal.abort(),
        async *[Symbol.asyncIterator]() { yield Buffer.from(body); } },
      { writableEnded: false, on() { return this; }, writeHead() {}, end(value) { captured.body = value ?? ""; this.writableEnded = true; } });
    return JSON.parse(captured.body).result;
  };
  return { ctx, call };
}

test("the stored strategy defaults reach the Session the composer reads", async t => {
  const { call } = await host(t, { defaultConfig: "gpt-workflow", codingStrategy: "expert", integrateStrategy: "bootstrap", configs: {} });
  const configurations = await call("configurations", {});
  assert.deepEqual(configurations.value.strategies, { coding: "expert", integrate: "bootstrap" });
  const profiles = await call("profiles", { sessionId: "parent" });
  assert.deepEqual(profiles.value.strategy,
    { preference: null, default: "expert", effective: "independent", sameModel: false, fixed: false },
    "a Session without an override inherits the stored coding default, not the integrate one");
  assert.equal(profiles.value.selectedProfile, "gpt-workflow");
});

test("an unset stored section falls back to the shipped strategy defaults", async t => {
  const { call } = await host(t, { defaultConfig: "", codingStrategy: "adaptive", integrateStrategy: "economy", configs: {} });
  const profiles = await call("profiles", { sessionId: "parent" });
  assert.deepEqual(profiles.value.strategy,
    { preference: null, default: "adaptive", effective: "adaptive", sameModel: false, fixed: false });
});

test("a same-model Profile reports fixed independent execution to the composer", async t => {
  const { call } = await host(t, {
    defaultConfig: "gpt-workflow", codingStrategy: "bootstrap", integrateStrategy: "economy",
    configs: { "gpt-workflow": { roles: {
      def_coding_worker: { provider: "codex", model: "one-model", reasoningEffort: "medium" },
      sup_coding_worker: { provider: "codex", model: "one-model", reasoningEffort: "high" },
    } } },
  });
  const profiles = await call("profiles", { sessionId: "parent" });
  assert.deepEqual(profiles.value.strategy,
    { preference: null, default: "bootstrap", effective: "independent", sameModel: true, fixed: true },
    "the composer hides the control and the effective strategy is the derived one");
  assert.equal(profiles.value.configs.find(config => config.id === "gpt-workflow").sameModel, true);
});
