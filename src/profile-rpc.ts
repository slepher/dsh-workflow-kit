import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-connection";
import type {} from "@deepseek-ai/dsh-session-persistence";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { WorkflowConfiguration } from "./configuration.js";
import type { WorkflowStore } from "./store.js";
import { ROLES } from "./roles.js";

/** The standard Connection transport supplies browser authentication and the Host/Origin fence. */
export function installProfileRpc(ctx: Context, catalog: WorkflowConfiguration, store: WorkflowStore, defaultProfile?: string): void {
  ctx.inject(["connection", "webServer"], scope => {
    let queue: Promise<unknown> = Promise.resolve();
    scope.connection.rpc.handle("/workflow", (endpoint, payload, signal) => {
      const operation = queue.then(async () => {
        signal.throwIfAborted();
        if (!["profiles", "select-profile", "reload-configuration"].includes(endpoint)) throw new Error("Unknown workflow endpoint");
        if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid workflow request");
        const value = payload as Record<string, unknown>;
        const fields = endpoint === "select-profile" ? ["sessionId", "profileId"] : ["sessionId"];
        if (Object.keys(value).some(key => !fields.includes(key)) || typeof value.sessionId !== "string" || !value.sessionId) throw new Error("A native Session address is required; caller identities are not accepted");
        const id = SessionId(value.sessionId);
        const header = scope.sessions.get(id)?.header ?? (await scope.get("sessionPersistence")?.stat(id, { signal }))?.header;
        signal.throwIfAborted();
        if (header?.id !== id) throw new Error("Native Session is unavailable");
        if (endpoint === "reload-configuration") catalog.reload();
        if (endpoint === "select-profile") {
          if (typeof value.profileId !== "string" || !catalog.view().profiles.some(profile => profile.id === value.profileId)) throw new Error("Selected workflow profile is unavailable");
          store.selectProfile(id, value.profileId);
        }
        return { selectedProfile: store.selectedProfile(id, defaultProfile) ?? null, ...catalog.view(ROLES.map(role => role.name)) };
      });
      queue = operation.catch(() => {});
      return operation.then(value => ({ ok: true as const, value }), error => ({ ok: false as const,
        error: { code: "workflow/rejected", message: error instanceof Error ? error.message : String(error), details: {} } }));
    });
  });
}
