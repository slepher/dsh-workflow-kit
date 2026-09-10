import { listRoles } from "./roles.js";
import type { WorkerAction } from "./types.js";
import type { Workers } from "./workers.js";

export async function executeWorkerAction(workers: Workers, parentId: string, parentCwd: string, input: WorkerAction): Promise<unknown> {
  if (!parentId || !input || typeof input.action !== "string") throw new Error("A live parent and action are required");
  if (input.action === "roles") return listRoles();
  if (input.action === "list") return workers.list(parentId);
  if (input.action === "reports") return workers.pending(parentId);
  if (input.action === "create") return workers.create(parentId, { ...input, cwd: input.cwd ?? parentCwd });
  const id = "workerId" in input ? input.workerId : "";
  switch (input.action) {
    case "get": return workers.get(parentId, id);
    case "append": return workers.append(parentId, id, input.text);
    case "steer": return workers.steer(parentId, id, input.turnId, input.text);
    case "interrupt": return workers.interrupt(parentId, id, input.turnId);
    case "resume": return workers.resume(parentId, id, input.confirmedStopped === true);
    case "ack": return workers.acknowledge(parentId, id, input.turnId);
    case "accept": return workers.accept(parentId, id, input.turnId, input.acceptance);
    case "close": return workers.closeWorker(parentId, id, input.confirmedStopped === true);
    case "configure": return workers.configure(parentId, id, input.model, input.effort);
    case "approve": return workers.approve(parentId, id, input.approvalId, input.decision);
  }
}
