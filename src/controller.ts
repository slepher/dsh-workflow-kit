import { conversation } from "./conversation.js";
import { listRoles } from "./roles.js";
import { resolveSkills } from "./skills.js";
import type { Action, Effort, ModelSettings, Skill } from "./types.js";
import type { Workers } from "./workers.js";

const efforts = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

export async function executeWorkerAction(
  workers: Workers,
  parentId: string,
  parentCwd: string,
  input: Action,
  ui = false,
): Promise<unknown> {
  if (!parentId || !input || typeof input.action !== "string") throw new Error("A live parent and action are required");
  if (input.action === "roles") return listRoles();
  if (input.action === "models") return modelSettings(workers, input.workerId ? workers.get(parentId, input.workerId).cwd : parentCwd);
  if (input.action === "skills") return skills(workers, input.workerId ? workers.get(parentId, input.workerId).cwd : parentCwd);
  if (input.action === "list") return workers.list(parentId).filter(worker => ui || worker.owner !== "user");
  if (input.action === "reports") return workers.pending(parentId);
  if (input.action === "sessions") {
    if (!ui) throw new Error("Resume browser is a UI action");
    return workers.backend.searchThreads(`workflow:${parentId}`, input.search, input.cursor);
  }
  if (input.action === "adopt") {
    if (!ui || !input.threadId) throw new Error("Resume browser is a UI action");
    return workers.adopt(parentId, input.threadId);
  }
  if (input.action === "create") {
    if (!input.name?.trim()) throw new Error("name must be a nonempty string");
    if (input.effort !== undefined && !efforts.has(input.effort)) throw new Error("Invalid reasoning effort");
    return workers.create(parentId, { name: input.name, cwd: input.cwd ?? parentCwd, role: input.role, model: input.model, effort: input.effort, owner: ui ? "user" : "agent" });
  }
  if (!input.workerId) throw new Error("workerId must be a nonempty string");
  const worker = workers.get(parentId, input.workerId);
  if (!ui && worker.owner === "user") throw new Error("User conversation is not linked to this agent");
  switch (input.action) {
    case "get": return worker;
    case "link": if (!ui) throw new Error("Link requires UI"); return workers.link(parentId, worker.id);
    case "detach": if (!ui) throw new Error("Remove requires UI"); return workers.detach(parentId, worker.id);
    case "conversation": {
      if (!ui || !worker.threadId) throw new Error("Conversation history is a UI action");
      return conversation({ turns: await workers.backend.history(`workflow:${parentId}`, worker.id) });
    }
    case "configure": {
      if (!ui || !input.model || !input.effort) throw new Error("Model configuration requires UI");
      const catalog = await modelSettings(workers, worker.cwd);
      const model = catalog.models.find(item => item.model === input.model);
      if (!model?.supportedReasoningEfforts.some(item => item.reasoningEffort === input.effort)) throw new Error("Unsupported model or reasoning effort");
      return workers.configure(parentId, worker.id, input.model, input.effort);
    }
    case "compact": if (!ui) throw new Error("Compaction requires UI"); return workers.compact(parentId, worker.id);
    case "review": if (!ui) throw new Error("Review requires UI"); return workers.review(parentId, worker.id);
    case "append": {
      if (!input.text?.trim()) throw new Error("text must be a nonempty string");
      const selected = await selectedSkills(workers, worker.cwd, input.text, input.skills);
      try { return { worker: await workers.append(parentId, worker.id, input.text, false, selected) }; }
      catch (error) { return { worker: workers.get(parentId, worker.id), error: String(error) }; }
    }
    case "steer": return workers.steer(parentId, worker.id, required(input.turnId, "turnId"), required(input.text, "text"), false, await selectedSkills(workers, worker.cwd, input.text ?? "", input.skills));
    case "interrupt": return workers.interrupt(parentId, worker.id, required(input.turnId, "turnId"));
    case "resume": return workers.resume(parentId, worker.id, ui && input.confirmedStopped === true);
    case "ack": return workers.acknowledge(parentId, worker.id, required(input.turnId, "turnId"));
    case "accept": return workers.accept(parentId, worker.id, required(input.turnId, "turnId"), required(input.acceptance, "acceptance") as "pending" | "accepted" | "changes-requested");
    case "close": return workers.closeWorker(parentId, worker.id, ui && input.confirmedStopped === true);
    case "approve": if (!ui) throw new Error("Approval requires an explicit UI action"); return workers.approve(parentId, worker.id, required(input.approvalId, "approvalId"), input.decision as "accept" | "decline" | "cancel");
    default: throw new Error("Unknown worker action");
  }
}

async function modelSettings(workers: Workers, cwd: string): Promise<ModelSettings> {
  const [configValue, values] = await Promise.all([workers.backend.readConfig(cwd), workers.backend.listModels(cwd)]);
  const config = object(object(configValue).config);
  const models = values.map(value => object(value)).filter(value => typeof value.model === "string").map(value => ({
    model: value.model as string,
    displayName: typeof value.displayName === "string" ? value.displayName : value.model as string,
    supportedReasoningEfforts: Array.isArray(value.supportedReasoningEfforts) ? value.supportedReasoningEfforts.map(item => typeof item === "string" ? { reasoningEffort: item as Effort, description: item } : object(item)).filter(item => typeof item.reasoningEffort === "string") as ModelSettings["models"][number]["supportedReasoningEfforts"] : [],
    defaultReasoningEffort: (typeof value.defaultReasoningEffort === "string" ? value.defaultReasoningEffort : "medium") as Effort,
  }));
  const defaultModel = values.find(value => object(value).isDefault === true);
  const model = typeof config.model === "string" ? config.model : typeof object(defaultModel).model === "string" ? object(defaultModel).model as string : null;
  return { models, model, effort: (typeof config.model_reasoning_effort === "string" ? config.model_reasoning_effort : models.find(item => item.model === model)?.defaultReasoningEffort ?? null) as Effort | null };
}

async function skills(workers: Workers, cwd: string): Promise<Skill[]> {
  const entries = await workers.backend.listSkills(cwd) as any[];
  const matching = entries.filter(entry => entry?.cwd === cwd);
  const errors = matching.flatMap(entry => entry.errors ?? []);
  if (errors.length) throw new Error(errors.map(error => `${error.path}: ${error.message}`).join("\n"));
  return matching.flatMap(entry => entry.skills ?? []).filter(skill => skill.enabled).map(({ name, path, description }) => ({ name, path, description }));
}

async function selectedSkills(workers: Workers, cwd: string, text: string, selected?: Skill[]): Promise<Skill[]> {
  return selected?.length || /(?:^|\s)\$[\w:-]+/.test(text) ? resolveSkills(text, await skills(workers, cwd), selected) : [];
}

function object(value: unknown): Record<string, any> { return typeof value === "object" && value !== null ? value as Record<string, any> : {}; }
function required(value: unknown, name: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a nonempty string`); return value; }
