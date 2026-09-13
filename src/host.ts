import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type {} from "dsh-codex-app-provider";
import { installProfileRpc } from "./profile-rpc.js";
import { WorkflowConfiguration } from "./configuration.js";
import { WorkflowStore } from "./store.js";
import { Workflow } from "./workflow.js";
import { WorkflowWorkers } from "./workers.js";

export const name = "dsh-workflow-kit";
export const inject = ["tools", "agents", "sessions", "subagents", "codexExecution"];

export interface Config { stateDir: string; workflowSkillDir?: string; implementationStandardDir?: string; subdir?: string; defaultProfile?: string }

/** Install workflow policy over native DSH children and read-only Codex execution facts. */
export function apply(ctx: Context, config?: Config): void {
  if (!config?.stateDir) throw new Error("stateDir is required for workflow execution");
  const catalog = new WorkflowConfiguration(config.subdir);
  const store = new WorkflowStore(config.stateDir);
  installProfileRpc(ctx, catalog, store, config.defaultProfile);
  const consumer = new WorkflowWorkers(ctx, store, catalog, config.defaultProfile, config.workflowSkillDir, config.implementationStandardDir);
  const workflow = new Workflow(consumer, config.workflowSkillDir);
  ctx.tools.register(defineTool({
    name: "codex_workflow",
    description: "Execute an adopted workflow generation with lane, review, integration, acceptance, and release constraints.",
    parameters: {
      action: { type: "string", required: true, enum: ["status", "adopt", "dispatch", "record-result", "accept", "integrate", "resolve", "resolved", "continue", "refresh-integration", "archive", "release"] },
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
    presentCall: args => ({ card: "generic", title: `Codex workflow: ${args.action}`, kind: args.action === "status" ? "read" : "execute" }),
  }));
}

