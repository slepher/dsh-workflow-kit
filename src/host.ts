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
    description: `Execute an adopted workflow generation with lane, review, integration, acceptance, and release constraints. This tool owns the execution role catalogue, and \`dispatch\` starts a child under one of these roles: ${ROLES.map(role => role.name).join(", ")}. \`roles\` lists them with their descriptions. \`delegate\` assigns one bounded task to a role directly, without adopting a generation: it returns the child's handle, which the same action continues (send \`text\` again) or stops (\`stop\`). A delegation writes only where \`writes\` names an absolute path, and is read-only without it. The Codex worker tool starts plain workers and has no roles.`,
    parameters: {
      action: { type: "string", required: true, enum: ["roles", "status", "adopt", "dispatch", "record-result", "accept", "integrate", "resolve", "resolved", "continue", "refresh-integration", "archive", "release", "delegate"] },
      role: { type: "string" }, worker: { type: "string" }, stop: { type: "boolean" }, name: { type: "string" }, cwd: { type: "string" },
      writes: { type: "array", items: { type: "string" } }, network: { type: "string", enum: ["disabled", "loopback"] },
      generation: { type: "string" }, task: { type: "string" }, attempt: { type: "number" }, lane: { type: "string" }, base: { type: "string" }, result: { type: "string" }, text: { type: "string" }, recipient: { type: "string" }, processesStopped: { type: "boolean" },
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

