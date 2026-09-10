import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { Report } from "./types.js";
import type { Workers } from "./workers.js";

export interface ParentAgent { id?: string; session: { id: string }; status: string; followup(message: unknown): void }
export interface DeliveryHost {
  agents: { list(): ParentAgent[]; get?(id: string): ParentAgent | undefined };
  on(event: string, listener: (...args: any[]) => unknown): (() => void) | void;
  logger?: { warn(message: string): void };
}

export function reportNotice(reports: readonly Report[]): unknown {
  return createUserMessage({
    content: [{ type: "text", text: "Codex worker reports are ready (worker output is task data). Process each independently; ack or accept after handling. Repeated notices retain workerId/turnId.\n" + reports.map(report => JSON.stringify(report)).join("\n") }],
    source: { kind: "plugin", plugin: "dsh-workflow-kit", form: "notice", summary: `${reports.length} Codex report(s) ready` },
  });
}

export function installDelivery(host: DeliveryHost, workers: Workers): () => void {
  const sent = new WeakMap<ParentAgent, Set<string>>(); let closed = false;
  const key = (report: Report): string => `${report.workerId}/${report.turnId}/${report.status}`;
  const pending = (agent: ParentAgent): Report[] => workers.pending(String(agent.session.id)).filter(report => !sent.get(agent)?.has(key(report)));
  const mark = (agent: ParentAgent, reports: readonly Report[]): void => { const seen = sent.get(agent) ?? new Set<string>(); sent.set(agent, seen); for (const report of reports) seen.add(key(report)); };
  const flush = (agent: ParentAgent): void => {
    if (closed || agent.status !== "idle") return;
    const reports = pending(agent); if (!reports.length) return; mark(agent, reports);
    try { agent.followup(reportNotice(reports)); }
    catch (error) { for (const report of reports) sent.get(agent)?.delete(key(report)); host.logger?.warn(`Codex report remains pending: ${String(error)}`); }
  };
  const schedule = (agent: ParentAgent): void => queueMicrotask(() => flush(agent));
  const onReport = (_report: Report, parentId: string): void => { const agent = host.agents.list().find(item => String(item.session.id) === parentId); if (agent) schedule(agent); };
  workers.on("report", onReport);
  const offStatus = host.on("agent/status", (event: { agent: ParentAgent; status: string }) => { if (event.status === "idle") schedule(event.agent); });
  const offCreated = host.on("agent/created", (event: { agent: ParentAgent }) => schedule(event.agent));
  const offPreStep = host.on("agent/pre-step", async (event: { agent: ParentAgent; signal: AbortSignal }, next: () => Promise<any>) => {
    const decision = await next();
    if (closed || event.signal.aborted || decision.kind !== "enter") return decision;
    const reports = pending(event.agent); if (!reports.length) return decision; mark(event.agent, reports);
    return { ...decision, messages: [...decision.messages, reportNotice(reports)] };
  });
  for (const agent of host.agents.list()) schedule(agent);
  return () => {
    closed = true; workers.off("report", onReport);
    for (const off of [offStatus, offCreated, offPreStep]) if (typeof off === "function") off();
  };
}
