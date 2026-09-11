import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

async function load(require, name) {
  return import(pathToFileURL(require.resolve(name)));
}

export async function verifyInstalledRuntime(directory, { client, workflow }) {
  const require = createRequire(join(directory, "runtime.cjs"));
  const { Context, Service } = await load(require, "@deepseek-ai/cordis");
  const backendRoot = await load(require, "dsh-codex-kit-backend");
  const backendHost = await load(require, "dsh-codex-kit-backend/host");
  const workflowRoot = workflow ? await load(require, "dsh-workflow-kit") : undefined;
  const clientRoot = client ? await load(require, "dsh-codex-kit") : undefined;
  const stateDir = mkdtempSync(join(tmpdir(), "dsh-pack-runtime-"));
  const ctx = new Context();

  class Tools extends Service {
    entries = new Map();
    constructor(scope) { super(scope, "tools"); }
    register(tool) {
      if (this.entries.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`);
      this.entries.set(tool.name, tool);
      this.ctx.effect(() => () => this.entries.delete(tool.name));
    }
  }
  class Prompts extends Service {
    entries = new Map();
    constructor(scope) { super(scope, "systemPrompt"); }
    getSectionOrder() { return 1; }
    section(value) {
      if (this.entries.has(value.name)) throw new Error(`duplicate prompt: ${value.name}`);
      this.entries.set(value.name, value);
      this.ctx.effect(() => () => this.entries.delete(value.name));
    }
  }
  class Sessions extends Service {
    values = new Map();
    constructor(scope) { super(scope, "sessions"); }
    get(id) { return this.values.get(String(id)); }
  }
  class Agents extends Service {
    values = new Map();
    constructor(scope) { super(scope, "agents"); }
    get(id) { return this.values.get(String(id)); }
    list() { return [...this.values.values()]; }
  }
  class Connection extends Service {
    routes = new Map();
    constructor(scope) { super(scope, "connection"); }
    get fetch() { return this; }
    register(route) {
      if (this.routes.has(route.path)) throw new Error(`duplicate route: ${route.path}`);
      this.routes.set(route.path, route);
      this.ctx.effect(() => () => this.routes.delete(route.path));
    }
  }

  try {
    const tools = new Tools(ctx), prompts = new Prompts(ctx), sessions = new Sessions(ctx), agents = new Agents(ctx);
    const connection = client ? new Connection(ctx) : undefined;
    const session = { id: "parent", header: { cwd: stateDir } };
    const agent = { id: "parent", session, status: "idle", followup() {} };
    sessions.values.set(session.id, session); agents.values.set(agent.id, agent);

    await ctx.plugin({ apply: backendRoot.apply, inject: backendRoot.inject ?? [] }, { stateDir, command: "pack-check-codex-must-not-run" });
    await ctx.plugin({ apply: backendHost.apply, inject: backendHost.inject });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual([...tools.entries.keys()], ["codex_workers"]);
    assert.deepEqual([...prompts.entries.keys()], ["tool:codex-workers"]);
    assert.throws(() => backendHost.apply(ctx), /already installed|duplicate/);

    const backend = ctx.codexKit.backend;
    let backendClosed = 0, provider, providerRegistrations = 0;
    const close = backend.close.bind(backend), registerWorkflow = backend.registerWorkflow.bind(backend);
    backend.close = async (...args) => { backendClosed++; return close(...args); };
    backend.registerWorkflow = value => { provider = value; providerRegistrations++; return registerWorkflow(value); };

    let workflowPlugin;
    if (workflow) {
      workflowPlugin = await ctx.plugin({ apply: workflowRoot.apply, inject: workflowRoot.inject }, { stateDir });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(providerRegistrations, 1);
      assert.equal(provider.resolveRole("evidence_runner").name, "evidence_runner");
      assert.throws(() => provider.authorize(
        { nativeSessionId: "parent", source: "agent", parentAgent: { id: "parent", nativeSessionId: "parent" } },
        "outside-workflow", "create",
      ), /not ready/, "installed W policy must fail closed outside its managed scope");
      assert.deepEqual([...tools.entries.keys()].sort(), ["codex_workers", "codex_workflow"]);
      const status = await tools.entries.get("codex_workflow").execute({ action: "status" }, { agent, signal: new AbortController().signal });
      assert.deepEqual(JSON.parse(status), { adopted: false });
      assert.throws(() => backend.registerWorkflow(provider), /already registered/);
    }

    if (client) {
      await ctx.plugin({ apply: clientRoot.apply, inject: clientRoot.inject });
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual([...connection.routes.keys()].sort(), ["/api/codex", "/api/codex/events"]);
    }

    if (workflowPlugin) {
      await workflowPlugin.dispose();
      assert.deepEqual([...tools.entries.keys()], ["codex_workers"]);
      const listed = await tools.entries.get("codex_workers").execute({ action: "list" }, { agent, signal: new AbortController().signal });
      assert.deepEqual(JSON.parse(listed), []);
      if (client) assert.deepEqual([...connection.routes.keys()].sort(), ["/api/codex", "/api/codex/events"]);
      assert.equal(backendClosed, 0, "unloading W must not close B or C");
    }
  } finally {
    await ctx.fiber.dispose();
    rmSync(stateDir, { recursive: true, force: true });
  }
}
