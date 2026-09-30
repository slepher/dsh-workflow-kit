import type { Context, Volatile } from "@deepseek-ai/cordis";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";
import type {} from "dsh-codex-app-provider";
import type {} from "@deepseek-ai/dsh-settings";
// Type-only: the Loader's `loader/volatile-update` instance event.
import type {} from "@deepseek-ai/cordis-plugin-loader";
import { installProfileRpc } from "./profile-rpc.js";
import { WorkflowConfiguration, loadBuiltinProfiles, roleInstructions } from "./configuration.js";
import { WorkflowConfigFields, type WorkflowSettings } from "./settings.js";
import { WorkflowStore } from "./store.js";
import { Workflow } from "./workflow.js";
import { ROLES } from "./roles.js";
import { WorkflowWorkers } from "./workers.js";
import { installedCodexToolGate, workflowGateHandler, WORKFLOW_GATE_HOOK } from "./gate.js";

export const name = "dsh-workflow-kit";
/**
 * The Codex provider publishes the gate as its own capability. It is required
 * rather than optional: a package set without it cannot gate a Codex child, and
 * starting one ungated would silently run the broadest authority there is.
 */
export const inject = ["tools", "agents", "sessions", "subagents", "codexExecution", "codexToolGate"];

/**
 * The plugin's entry configuration.
 *
 * The profile patch carries the deployment fields (`stateDir`, the two skill
 * directories, the fallback profile); the plugin's configuration form owns the
 * four volatile ones. `stateDir` stays plain on purpose: moving the state
 * directory is a deployment change, and the Loader remounts this plugin for it.
 */
export interface Config {
  /**
   * Where adopted runs, lanes, and child bindings are persisted. Omitted means
   * the launched profile's own state directory.
   */
  stateDir?: string;
  /** Directory of the shipped workflow skill, when the deployment installs one. */
  workflowSkillDir?: string;
  /** Directory of the shipped implementation standard, when the deployment installs one. */
  implementationStandardDir?: string;
  /** Deployment fallback for the configuration a new Session adopts. */
  defaultProfile?: string;
  /** Stored selection; empty defers to {@link Config.defaultProfile}. */
  defaultConfig: Volatile<string>;
  /** Stored coding default; a Session may override it in the composer. */
  codingStrategy: Volatile<WorkflowSettings["codingStrategy"]>;
  /** Stored integrate default; integration work uses it directly. */
  integrateStrategy: Volatile<WorkflowSettings["integrateStrategy"]>;
  /** Stored role overrides per configuration. */
  configs: Volatile<WorkflowSettings["configs"]>;
}

/**
 * The schema the Loader resolves this entry's Config with. The four volatile
 * fields are exactly the ones the plugin's configuration form edits live; the
 * rest are deployment inputs the patch supplies.
 */
export const Config = z.object({
  // Omittable: `apply` derives the launched profile's own state directory, so a
  // profile needs no line here to run.
  stateDir: z.string().required(false),
  workflowSkillDir: z.string().required(false),
  implementationStandardDir: z.string().required(false),
  defaultProfile: z.string().required(false),
  ...WorkflowConfigFields,
});

/**
 * Persistence root used when the entry config omits `stateDir`.
 *
 * The launcher-provided profile owns the Harness home and its own name, so the
 * fallback lands inside that profile's state tree. Resolving against the
 * current working directory instead would scatter state into whichever
 * directory `dsh` was started from, and two profiles started from one directory
 * would share it. A boot without a profile falls back to `$DSH_HOME`, then
 * `~/.dsh`, under the `default` profile name.
 * @param ctx - the Host context carrying the launcher-provided profile context.
 * @returns the absolute state directory for this deployment.
 */
function defaultStateDir(ctx: Context): string {
  const profile = ctx.get("profileContext") as { name?: string; home?: string } | undefined;
  const configuredHome = process.env.DSH_HOME?.trim();
  const home = profile?.home ?? (configuredHome === undefined || configuredHome === "" ? join(homedir(), ".dsh") : configuredHome);
  return join(home, "state", profile?.name ?? "default", "workflow");
}

/**
 * The DSH-native half of the session gate.
 *
 * It runs as a monotonic guard after every extensible `tools/pre-execute`
 * listener and before the tool body, so a denial means the model-visible
 * operation never executed. It answers only for a Session this Host registered:
 * a call with no agent, or one whose agent or Session is no longer the
 * registered instance, is left to the other checks in the pipeline.
 * @param ctx - the Host context carrying the live agent and session registries.
 * @param store - the workflow state holding each managed child's binding.
 * @param workflow - the adopted runs the manager binding is derived from.
 * @param execution - the pending tool call.
 * @returns a denial reason, or `undefined` to leave the call allowed.
 */
function nativeGate(ctx: Context, store: WorkflowStore, workflow: Workflow, execution: Readonly<ToolExecution>): string | undefined {
  const agent = execution.agent;
  if (agent === undefined) return undefined;
  if (ctx.agents.get(agent.id) !== agent) return undefined;
  const session = agent.session;
  if (ctx.sessions.get(session.id) !== session) return undefined;
  const sessionId = String(session.id);
  // A managed child carries its binding; the manager's is derived from the run
  // it adopted, so a new revision updates it without a second persisted table.
  // A Session with neither is not gated and keeps its previous behaviour.
  const binding = store.read().nativeChildren?.[sessionId]?.gate ?? workflow.managerBinding(sessionId);
  if (binding === undefined) return undefined;
  const cwd = typeof session.header?.cwd === "string" ? session.header.cwd : "";
  const decision = workflowGateHandler(binding, { source: "dsh", sessionId, callId: String(execution.callId),
    cwd, toolName: execution.name, toolArgs: execution.arguments });
  return decision.kind === "deny" ? decision.reason : undefined;
}

/** Install workflow policy over native DSH children and read-only Codex execution facts. */
export function apply(ctx: Context, config?: Config): void {
  // The Loader parses every entry through `Config`, which fills the four
  // volatile fields from their defaults; a direct mount with no config is
  // normalized the same way instead of failing on the first stored read.
  const entry: Config = config ?? new Config({});
  // Deployment state belongs to the profile that launched this process; an
  // explicit `stateDir` in the profile patch still wins.
  const stateDir = resolve(entry.stateDir ?? defaultStateDir(ctx));
  // The configuration form is this plugin's own page, so the settings service
  // must not also generate one from the schema.
  ctx.inject(["settings"], child => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)); });
  // Built-in configurations are package content; the entry config above carries
  // the only per-deployment state.
  const catalog = new WorkflowConfiguration(
    loadBuiltinProfiles(),
    roleInstructions(entry.workflowSkillDir, entry.implementationStandardDir),
  );
  const store = new WorkflowStore(stateDir);
  // The user's stored choice wins; the entry config is the deployment fallback
  // for a profile whose form holds no default.
  const defaultProfile = (): string | undefined => entry.defaultConfig.get() || entry.defaultProfile;
  // The stored fields are volatile references, so the catalog is re-fed whenever
  // one changes: a form edit lands without remounting this plugin.
  const syncStored = (): void => {
    catalog.setUserConfigs(entry.configs.get() as WorkflowSettings["configs"]);
    // The two strategy defaults are stored separately and both reach the
    // catalog here; neither is derived from the other.
    catalog.setUserStrategies({
      codingStrategy: entry.codingStrategy.get(),
      integrateStrategy: entry.integrateStrategy.get(),
    });
  };
  syncStored();
  ctx.on("loader/volatile-update", () => { syncStored(); });
  installProfileRpc(ctx, catalog, store, defaultProfile);
  const consumer = new WorkflowWorkers(ctx, store, catalog, defaultProfile, entry.workflowSkillDir, entry.implementationStandardDir);
  const workflow = new Workflow(consumer, entry.workflowSkillDir);
  // The gate is installed before any session can be started: the one business
  // handler is registered with the provider first, then the DSH-native guard.
  // Both entry points call the same function, and neither calls a model.
  const providerGate = installedCodexToolGate(ctx);
  if (providerGate === undefined) throw new Error("the installed Codex provider does not publish codexToolGate; a workflow child cannot be gated without it");
  ctx.effect(() => providerGate.register(WORKFLOW_GATE_HOOK, workflowGateHandler), "dsh-workflow-kit: Codex PreToolUse gate handler");
  ctx.effect(() => ctx.tools.guard(execution => nativeGate(ctx, store, workflow, execution)), "dsh-workflow-kit: native session gate guard");
  ctx.tools.register(defineTool({
    name: "codex_workflow",
    // The role catalogue is this tool's content, so the contract names it: a
    // caller asked for a role-bound child must not have to read the package to
    // learn which roles exist or which tool starts them.
    description: `Execute an adopted workflow generation with lane, review, integration, acceptance, and release constraints. This tool owns the execution role catalogue, and \`dispatch\` starts a child under one of these roles: ${ROLES.map(role => role.name).join(", ")}. \`roles\` lists them with their descriptions. \`complete\` only checks: every executable task must have delivered and released evidence and no lane or child may still be open. It performs no Git operation and refuses with the outstanding disposition instead of guessing, so call it before reporting the workflow finished. \`delegate\` assigns one bounded task to a role directly, without adopting a generation: pass \`role\` and the prompt as \`text\`. \`delegate\` answers before its child has worked. Every result carries the child's handle plus \`reply\`, or \`reply: null\` with the reason there is none; a child that has not settled yet is announced by the runtime's own settlement notice, which arrives as a new turn and carries the reply. Never poll, sleep, or re-call \`delegate\` to wait for a reply — end your turn and act when the notice arrives. The same action continues the child (send \`text\` again, with \`child\`) or stops it (\`stop\`). A delegation writes only where \`writes\` names an absolute path, and is read-only without it. Use \`delegate\` — not \`adopt\` — when the caller has no generation directory. The returned handle names a DSH child: \`codex_workers\` tracks its own workers and cannot read this one, so its \`get\`/\`reports\` will not find it.`,
    parameters: {
      action: { type: "string", required: true, enum: ["roles", "status", "adopt", "dispatch", "record-result", "accept", "integrate", "resolve", "resolved", "continue", "refresh-integration", "archive", "release", "complete", "delegate"], description: "The operation to perform. `roles` and `status` are reads; `complete` only checks and changes nothing; every other action starts or settles work." },
      role: { type: "string", description: "`delegate` only: which role the child runs as. Read the `roles` action for the catalogue." },
      child: { type: "string", description: "`delegate` only: an already-started child's handle. With it, `text` continues or steers that child and `stop` ends its current turn. Omit it to start a new child." },
      stop: { type: "boolean", description: "`delegate` only, together with `worker`: stop that child's current turn." },
      name: { type: "string", description: "`delegate` only: display name for the new child. Defaults to the role name." },
      cwd: { type: "string", description: "`delegate` only: absolute working directory for the new child. Defaults to the parent's workspace." },
      writes: { type: "array", items: { type: "string" }, description: "`delegate` only: absolute paths the child may write. An empty or absent list makes the delegation read-only." },
      network: { type: "string", enum: ["disabled", "loopback"], description: "`delegate` only: the child's network boundary. Defaults to `disabled`." },
      generation: { type: "string", description: "`adopt` only: the ABSOLUTE path of an existing `<repository>/agentwork/<goal>/generation-N` directory. A relative path is refused. Read `status` first: it reports whether this session already adopted one." },
      task: { type: "string", description: "Adopted-generation actions other than `adopt`: the task id from the adopted plan. `status` reports the ready ones. `delegate` does not use this field." },
      attempt: { type: "number", description: "With `task`: which attempt of that task to act on. Defaults to the newest." },
      lane: { type: "string", description: "`dispatch` and `integrate`: the lane to provision. Omit it to provision within policy." },
      base: { type: "string", description: "`dispatch`: the commit the attempt starts from. Defaults to the plan's base." },
      result: { type: "string", description: "`record-result`: the ABSOLUTE path of the retained report file holding the task result." },
      text: { type: "string", description: "Prompt text. `delegate` without `worker`: the task the new child starts with (required). `delegate` with `worker`: the follow-up to send. `continue`: the correction text (required)." },
      recipient: { type: "string", description: "`continue`: who receives the correction — `task` (default) or a worker id." },
      processesStopped: { type: "boolean", description: "`archive` and `release`: confirm that task-owned processes are stopped. Both refuse without it." },
    },
    output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
    async execute(args, execution) {
      const parent = execution.agent;
      if (parent === undefined) throw new Error("A live parent agent is required");
      const result = await consumer.run(parent, execution.signal, () =>
        workflow.execute(String(parent.session.id), args));
      return JSON.stringify(result);
    },
    presentCall: args => ({ card: "generic", title: `Codex workflow: ${args.action}`, kind: args.action === "roles" || args.action === "status" ? "read" : "execute" }),
  }));
}

