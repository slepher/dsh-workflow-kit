import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";
import type {} from "dsh-codex-app-provider";
import type {} from "@deepseek-ai/dsh-settings";
import { installProfileRpc } from "./profile-rpc.js";
import { WorkflowConfiguration, loadBuiltinProfiles, roleInstructions } from "./configuration.js";
import { WORKFLOW_SETTINGS_NAMESPACE, WorkflowSettingsSchema, type WorkflowSettings } from "./settings.js";
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

export interface Config { stateDir: string; workflowSkillDir?: string; implementationStandardDir?: string; defaultProfile?: string }

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
  if (!config?.stateDir) throw new Error("stateDir is required for workflow execution");
  // Built-in configurations are package content; the settings namespace below
  // carries the only per-deployment state.
  const catalog = new WorkflowConfiguration(
    loadBuiltinProfiles(),
    roleInstructions(config.workflowSkillDir, config.implementationStandardDir),
  );
  const store = new WorkflowStore(config.stateDir);
  // The user's stored choice wins; the entry config is the deployment fallback
  // for a Host whose settings namespace holds no default.
  let storedDefault = "";
  const defaultProfile = (): string | undefined => storedDefault || config.defaultProfile;
  ctx.inject(["settings"], scope => {
    const settings = scope.settings.register(WORKFLOW_SETTINGS_NAMESPACE, WorkflowSettingsSchema, { applies: "live" });
    const sync = (value: WorkflowSettings): void => {
      storedDefault = value.defaultConfig;
      catalog.setUserConfigs(value.configs);
      // The two strategy defaults are stored separately and both reach the
      // catalog here; neither is derived from the other.
      catalog.setUserStrategies(value);
    };
    sync(settings.get());
    scope.effect(() => settings.watch(next => { sync(next); }), "dsh-workflow-kit: stored configurations and strategies");
  });
  installProfileRpc(ctx, catalog, store, defaultProfile);
  const consumer = new WorkflowWorkers(ctx, store, catalog, defaultProfile, config.workflowSkillDir, config.implementationStandardDir);
  const workflow = new Workflow(consumer, config.workflowSkillDir);
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
    description: `Execute an adopted workflow generation with lane, review, integration, acceptance, and release constraints. This tool owns the execution role catalogue, and \`dispatch\` starts a child under one of these roles: ${ROLES.map(role => role.name).join(", ")}. \`roles\` lists them with their descriptions. \`delegate\` assigns one bounded task to a role directly, without adopting a generation: pass \`role\` and the prompt as \`text\`. \`delegate\` answers before its child has worked. Every result carries the child's handle plus \`reply\`, or \`reply: null\` with the reason there is none; a child that has not settled yet is announced by the runtime's own settlement notice, which arrives as a new turn and carries the reply. Never poll, sleep, or re-call \`delegate\` to wait for a reply — end your turn and act when the notice arrives. The same action continues the child (send \`text\` again, with \`child\`) or stops it (\`stop\`). A delegation writes only where \`writes\` names an absolute path, and is read-only without it. Use \`delegate\` — not \`adopt\` — when the caller has no generation directory. The returned handle names a DSH child: \`codex_workers\` tracks its own workers and cannot read this one, so its \`get\`/\`reports\` will not find it.`,
    parameters: {
      action: { type: "string", required: true, enum: ["roles", "status", "adopt", "dispatch", "record-result", "accept", "integrate", "resolve", "resolved", "continue", "refresh-integration", "archive", "release", "delegate"], description: "The operation to perform. `roles` and `status` are reads; every other action starts or settles work." },
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

