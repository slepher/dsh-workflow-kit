import { defineTool } from "@deepseek-ai/dsh-tools";
import { isAbsolute } from "node:path";
import { executeWorkerAction } from "./controller.js";
import { installDelivery } from "./delivery.js";
import { WorkflowStore } from "./store.js";
import { Workers } from "./workers.js";
import { Workflow } from "./workflow.js";
export const name = "dsh-workflow-kit";
export const inject = ["tools", "agents", "systemPrompt", "codexKit"];
const RPC_PATH = "/codex-workers";
const RPC_BODY_LIMIT = 1024 * 1024;
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
    ctx.inject(["connection", "webServer"], scope => {
        const execute = async (endpoint, payload) => {
            try {
                if (endpoint !== "action" || !payload || typeof payload !== "object")
                    throw new Error("Invalid worker request");
                const request = payload;
                if (typeof request.sessionId !== "string" || !request.input)
                    throw new Error("Session and action are required");
                const agent = [...ctx.agents.list()].find(candidate => String(candidate.session.id) === request.sessionId);
                if (!agent)
                    throw new Error("Parent session is not active");
                return { ok: true, value: await executeWorkerAction(workers, request.sessionId, String(agent.session.header.cwd), request.input, true) };
            }
            catch (error) {
                return { ok: false, error: { code: "codex/action-failed", message: error instanceof Error ? error.message : String(error), details: {} } };
            }
        };
        const webServer = scope.webServer;
        const connection = scope.connection;
        const streams = new Set();
        scope.effect(() => () => { for (const stream of streams)
            stream.end(); streams.clear(); });
        scope.effect(() => webServer.register({ kind: "prefix", path: RPC_PATH, handler: async (req, res) => {
                const rejection = connection.requestRejection(req);
                if (rejection !== undefined) {
                    res.writeHead(rejection);
                    res.end(rejection === 401 ? "unauthorized" : "forbidden");
                    return;
                }
                const url = new URL(req.url ?? "/", "http://dsh.internal");
                if (req.method === "GET" && url.pathname === `${RPC_PATH}/events`) {
                    const parentId = url.searchParams.get("sessionId") ?? "";
                    const workerId = url.searchParams.get("workerId") ?? "";
                    const agent = [...ctx.agents.list()].find(candidate => String(candidate.session.id) === parentId);
                    try {
                        if (!agent)
                            throw new Error("Parent is not active");
                        workers.get(parentId, workerId);
                    }
                    catch {
                        res.writeHead(403);
                        res.end("worker not found");
                        return;
                    }
                    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
                    res.write("event: ready\ndata: {}\n\n");
                    streams.add(res);
                    const notify = (ownerId, id, event) => {
                        if (ownerId === parentId && id === workerId && !res.write(`data: ${JSON.stringify(event)}\n\n`))
                            res.end();
                    };
                    workers.on("conversation", notify);
                    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
                    res.once("close", () => { clearInterval(heartbeat); workers.off("conversation", notify); streams.delete(res); });
                    return;
                }
                if (req.method !== "POST") {
                    res.writeHead(405);
                    res.end("method not allowed");
                    return;
                }
                const endpoint = url.pathname.startsWith(`${RPC_PATH}/`) ? url.pathname.slice(RPC_PATH.length + 1) : undefined;
                if (!endpoint) {
                    res.writeHead(404);
                    res.end("not found");
                    return;
                }
                const chunks = [];
                let bytes = 0;
                for await (const chunk of req) {
                    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    bytes += buffer.byteLength;
                    if (bytes > RPC_BODY_LIMIT) {
                        res.writeHead(413);
                        res.end("request too large");
                        return;
                    }
                    chunks.push(buffer);
                }
                let message;
                try {
                    message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                }
                catch {
                    res.writeHead(400);
                    res.end("body is not JSON");
                    return;
                }
                if (message?.type !== "client-request" || message.method !== endpoint || typeof message.rpcId !== "string") {
                    res.writeHead(400);
                    res.end("invalid rpc envelope");
                    return;
                }
                const result = await execute(endpoint, message.payload, new AbortController().signal);
                res.writeHead(200, { "content-type": "application/json" });
                res.end(JSON.stringify({ type: "server-response", rpcId: message.rpcId, result }));
            } }), "dsh-workflow-kit: browser RPC");
    });
}
//# sourceMappingURL=host.js.map