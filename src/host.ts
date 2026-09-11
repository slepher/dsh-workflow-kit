import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type {} from "dsh-codex-kit-backend";
import type { BackendMutationAction, Caller } from "dsh-codex-kit-backend/browser-types";
import { agentCaller, assertAgentIdentity, captureAgentIdentity } from "dsh-codex-kit-backend/host";
import { ROLES, resolveRole } from "./roles.js";
import { WorkflowStore } from "./store.js";
import { Workflow } from "./workflow.js";
import { WorkflowWorkers } from "./workers.js";

export const name = "dsh-workflow-kit";
export const inject = ["tools", "agents", "sessions", "codexKit"];

export interface Config { stateDir: string; workflowSkillDir?: string; implementationStandardDir?: string }

const NOT_READY = "Workflow backend integration is not ready";

/** Install Workflow roles and the managed orchestration consumer over B facts. */
export function apply(ctx: Context, config?: Config): void {
  if (!config?.stateDir) throw new Error("stateDir is required for workflow execution");
  const policy = new AsyncLocalStorage<{ caller: Caller; workerId: string; action: BackendMutationAction }>();
  let workflowStore: WorkflowStore | undefined, workers: WorkflowWorkers | undefined, workflow: Workflow | undefined;
  let registration: ReturnType<typeof ctx.codexKit.backend.registerWorkflow>;
  registration = ctx.codexKit.backend.registerWorkflow({
    listRoles: () => ROLES.map(role => {
      const resolved = resolveRole(role.name, config.workflowSkillDir, config.implementationStandardDir);
      return { name: resolved.name, developerInstructions: resolved.developerInstructions, model: resolved.model, reasoningEffort: resolved.effort };
    }),
    resolveRole: name => {
      const resolved = resolveRole(name, config.workflowSkillDir, config.implementationStandardDir);
      return { name: resolved.name, developerInstructions: resolved.developerInstructions, model: resolved.model, reasoningEffort: resolved.effort };
    },
    authorize: (caller, workerId, action) => {
      const value = policy.getStore();
      if (!value || value.workerId !== workerId || value.action !== action || !sameCaller(value.caller, caller)) throw new Error(NOT_READY);
    },
  });
  const managed = () => {
    workflowStore ??= new WorkflowStore(config.stateDir);
    workers ??= new WorkflowWorkers(ctx.codexKit.backend, workflowStore, (caller, workerId, action, operation) =>
      policy.run({ caller: structuredClone(caller), workerId, action }, () => registration.run(caller, workerId, action, operation)), config.workflowSkillDir, config.implementationStandardDir);
    return workers;
  };
  ctx.effect(() => () => registration.dispose(), "dsh-workflow-kit: backend provider");
  ctx.tools.register(defineTool({
    name: "codex_workflow",
    description: "Execute an adopted workflow generation with lane, review, integration, acceptance, and release constraints.",
    parameters: {
      action: { type: "string", required: true, enum: ["status", "adopt", "dispatch", "record-result", "accept", "integrate", "resolve", "resolved", "continue", "refresh-integration", "archive", "release"] },
      generation: { type: "string" }, task: { type: "string" }, attempt: { type: "number" }, lane: { type: "string" }, base: { type: "string" }, result: { type: "string" }, text: { type: "string" }, recipient: { type: "string" }, processesStopped: { type: "boolean" },
    },
    output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
    async execute(args, execution) {
      const identity = captureAgentIdentity(ctx, execution.agent), caller = agentCaller(identity), consumer = managed();
      const result = await consumer.run(caller, () => assertAgentIdentity(ctx, identity), () => {
        workflow ??= new Workflow(consumer, config.workflowSkillDir);
        return workflow.execute(caller.nativeSessionId, args);
      });
      return JSON.stringify(result);
    },
    presentCall: args => ({ card: "generic", title: `Codex workflow: ${args.action}`, kind: args.action === "status" ? "read" : "execute" }),
  }));
}

function sameCaller(left: Caller, right: Caller): boolean {
  return left.nativeSessionId === right.nativeSessionId && left.source === right.source
    && left.parentAgent?.id === right.parentAgent?.id && left.parentAgent?.nativeSessionId === right.parentAgent?.nativeSessionId;
}
