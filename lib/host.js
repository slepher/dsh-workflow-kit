import { defineTool } from "@deepseek-ai/dsh-tools";
import { isAbsolute } from "node:path";
import { executeWorkerAction } from "./controller.js";
import { installDelivery } from "./delivery.js";
import { WorkflowStore } from "./store.js";
import { Workers } from "./workers.js";
import { Workflow } from "./workflow.js";
export const name = "dsh-workflow-kit";
export const inject = ["tools", "agents", "systemPrompt", "codexKit"];
function live(ctx, agent) {
    if (!agent || ctx.agents.get(agent.id) !== agent)
        throw new Error("A live parent agent is required");
    return agent;
}
export function apply(ctx, config) {
    if (!config || !isAbsolute(config.stateDir) || !isAbsolute(config.workflowSkillDir))
        throw new Error("Absolute stateDir and workflowSkillDir are required");
    const store = new WorkflowStore(config.stateDir);
    const workers = new Workers(ctx.codexKit.backend, store, config.workflowSkillDir, config.implementationStandardDir);
    const workflow = new Workflow(workers, config.workflowSkillDir);
    void workers.reconcileAll().catch(error => ctx.logger.warn(`Workflow reconciliation failed: ${String(error)}`));
    const disposeDelivery = installDelivery(ctx, workers);
    ctx.effect(() => () => { disposeDelivery(); void workers.close(); }, "dsh-workflow-kit lifecycle");
    ctx.tools.register(defineTool({
        name: "codex_workers",
        description: "Create, query, and control persistent Codex workers owned by this parent Session. Reports are durable and acknowledgement is separate from acceptance.",
        parameters: {
            action: { type: "string", required: true, enum: ["create", "roles", "list", "get", "reports", "append", "steer", "interrupt", "resume", "configure", "approve", "accept", "ack", "close"] },
            role: { type: "string" }, workerId: { type: "string" }, name: { type: "string" }, cwd: { type: "string" }, model: { type: "string" }, effort: { type: "string" }, text: { type: "string" }, turnId: { type: "string" }, approvalId: { type: "string" }, decision: { type: "string" }, acceptance: { type: "string" }, confirmedStopped: { type: "boolean" },
        },
        output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
        async execute(args, execution) {
            const agent = live(ctx, execution.agent);
            return JSON.stringify(await executeWorkerAction(workers, String(agent.session.id), String(agent.session.header.cwd), args));
        },
        presentCall: args => ({ card: "generic", title: `Codex workers: ${args.action}`, kind: ["list", "get", "reports", "roles"].includes(args.action) ? "read" : "execute" }),
    }));
    ctx.tools.register(defineTool({
        name: "codex_workflow",
        description: "Execute an adopted workflow generation with lane, review, integration, acceptance, and release constraints.",
        parameters: {
            action: { type: "string", required: true, enum: ["status", "adopt", "dispatch", "record-result", "accept", "integrate", "resolve", "resolved", "continue", "refresh-integration", "archive", "release"] },
            generation: { type: "string" }, task: { type: "string" }, attempt: { type: "number" }, lane: { type: "string" }, base: { type: "string" }, result: { type: "string" }, text: { type: "string" }, recipient: { type: "string" }, processesStopped: { type: "boolean" },
        },
        output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
        async execute(args, execution) { const agent = live(ctx, execution.agent); return JSON.stringify(await workflow.execute(String(agent.session.id), args)); },
        presentCall: args => ({ card: "generic", title: `Codex workflow: ${args.action}`, kind: args.action === "status" ? "read" : "execute" }),
    }));
    ctx.systemPrompt.section({ name: "tool:codex-workers", order: ctx.systemPrompt.getSectionOrder("TOOL_JOBS"), text: "codex_workers manages persistent workers. Process durable reports independently; ack or accept after handling. Do not poll, repeat unknown work, or treat interrupt acceptance as completion. Managed tasks use codex_workflow for mutations, acceptance, integration, and release." });
}
//# sourceMappingURL=host.js.map