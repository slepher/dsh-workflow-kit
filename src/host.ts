import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type {} from "dsh-codex-app-provider";
import type {} from "@deepseek-ai/dsh-settings";
import { installProfileRpc } from "./profile-rpc.js";
import { WorkflowConfiguration, loadBuiltinProfiles, roleInstructions } from "./configuration.js";
import { WORKFLOW_SETTINGS_NAMESPACE, WorkflowSettingsSchema, type WorkflowSettings } from "./settings.js";
import { WorkflowStore } from "./store.js";
import { Workflow } from "./workflow.js";
import { ROLES } from "./roles.js";
import { WorkflowWorkers } from "./workers.js";

export const name = "dsh-workflow-kit";
export const inject = ["tools", "agents", "sessions", "subagents", "codexExecution"];

export interface Config { stateDir: string; workflowSkillDir?: string; implementationStandardDir?: string; defaultProfile?: string }

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
  ctx.tools.register(defineTool({
    name: "codex_workflow",
    // The role catalogue is this tool's content, so the contract names it: a
    // caller asked for a role-bound child must not have to read the package to
    // learn which roles exist or which tool starts them.
    description: `Execute an adopted workflow generation with lane, review, integration, acceptance, and release constraints. This tool owns the execution role catalogue, and \`dispatch\` starts a child under one of these roles: ${ROLES.map(role => role.name).join(", ")}. \`roles\` lists them with their descriptions. \`delegate\` assigns one bounded task to a role directly, without adopting a generation: pass \`role\` and the prompt as \`text\`. \`delegate\` answers before its child has worked. Every result carries the child's handle plus \`reply\`, or \`reply: null\` with the reason there is none; a child that has not settled yet is announced by the runtime's own settlement notice, which arrives as a new turn and carries the reply. Never poll, sleep, or re-call \`delegate\` to wait for a reply — end your turn and act when the notice arrives. The same action continues the child (send \`text\` again, with \`worker\`) or stops it (\`stop\`). A delegation writes only where \`writes\` names an absolute path, and is read-only without it. Use \`delegate\` — not \`adopt\` — when the caller has no generation directory. The Codex worker tool starts plain workers and has no roles.`,
    parameters: {
      action: { type: "string", required: true, enum: ["roles", "status", "adopt", "dispatch", "record-result", "accept", "integrate", "resolve", "resolved", "continue", "refresh-integration", "archive", "release", "delegate"], description: "The operation to perform. `roles` and `status` are reads; every other action starts or settles work." },
      role: { type: "string", description: "`delegate` only: which role the child runs as. Read the `roles` action for the catalogue." },
      worker: { type: "string", description: "`delegate` only: an already-started child's handle. With it, `text` continues or steers that child and `stop` ends its current turn. Omit it to start a new child." },
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

