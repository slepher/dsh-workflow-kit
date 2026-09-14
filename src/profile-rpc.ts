import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-connection";
import type { ConnectionRpcResult, ConnectionTrustRequest, HostConnectionHandle } from "@deepseek-ai/dsh-client-connection";
import { clientRequestSchema, serverResponseSchema } from "@deepseek-ai/dsh-client-connection";
import type {} from "@deepseek-ai/dsh-session-persistence";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { WorkflowConfiguration } from "./configuration.js";
import type { WorkflowStore } from "./store.js";
import { bindCodingStrategy, isStrategy, type CodingStrategy } from "./strategy.js";
import type { StrategyView } from "./profile-types.js";

const CHANNEL = "/workflow";
/** The browser carrier buffers one JSON body; profile payloads carry Session addresses and profile ids. */
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;
const INVALID_REQUEST_RPC_ID = "invalid-request";

/**
 * Resolve the coding strategy facts one Session reads. The Host owns this
 * derivation so the composer cannot disagree with dispatch: an explicit
 * Session preference wins, otherwise the stored coding default applies, and a
 * Profile whose sup/def share one provider and model fixes independent
 * execution without discarding the preference.
 */
function strategyView(catalog: WorkflowConfiguration, store: WorkflowStore, sessionId: string, defaultProfile: () => string | undefined): StrategyView {
  const preference = store.strategyPreference(sessionId);
  const selected = isStrategy(preference) ? preference : null;
  const fallback = catalog.strategies().coding;
  const binding = bindCodingStrategy(catalog.profile(store.selectedProfile(sessionId, defaultProfile())), selected ?? fallback, "main");
  return { preference: selected, default: fallback, effective: binding.effective, sameModel: binding.sameModel, fixed: binding.sameModel };
}

/** HTTP carrier facts this channel reads; the Web server's `node:http` request satisfies it structurally. */
interface RpcRequest extends ConnectionTrustRequest {
  readonly url?: string | undefined;
  readonly method?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  [Symbol.asyncIterator](): AsyncIterator<Buffer | string>;
}

/** HTTP carrier the Web server hands a route; `node:http` `ServerResponse` satisfies it structurally. */
interface RpcResponse {
  writeHead(status: number, headers?: Readonly<Record<string, string>>): unknown;
  end(body?: string): unknown;
}

/** Route carrier the Web server exposes; the packages' `WebServer` satisfies it structurally. */
interface WebServer {
  register(route: { kind: "prefix"; path: string; handler: (req: RpcRequest, res: RpcResponse) => Promise<void> }): () => void;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    webServer: WebServer;
  }
}

/** Read one carrier header; the request exposes either Fetch `Headers` or a node header record. */
function headerOf(request: ConnectionTrustRequest, name: string): string | undefined {
  if (typeof Headers !== "undefined" && request.headers instanceof Headers) return request.headers.get(name) ?? undefined;
  const value = (request.headers as Readonly<Record<string, string | readonly string[] | undefined>>)[name];
  return typeof value === "string" ? value : value?.[0];
}

/** Absolute endpoint segments below the channel prefix; an empty or malformed path has none. */
function endpointOf(pathname: string): string | undefined {
  if (!pathname.startsWith(`${CHANNEL}/`)) return undefined;
  const endpoint = pathname.slice(CHANNEL.length + 1);
  const malformed = endpoint.split("/").some(segment => segment === "" || segment === "." || segment === ".."
    || !/^[A-Za-z0-9_$.-]+$/.test(segment));
  return malformed ? undefined : endpoint;
}

/**
 * Serve profile reads and selections on an authenticated browser channel.
 *
 * The route is registered directly against the injecting Context instead of
 * through `connection.rpc.handle`: that registry reads the webServer it needs
 * from the Connection service's own fiber, which declares only `webRuntime`,
 * so the registration throws and the channel is never mounted. Registering here
 * keeps the route and its disposer owned by this fiber and reuses the public
 * Connection trust fence and envelope format.
 */
export function installProfileRpc(ctx: Context, catalog: WorkflowConfiguration, store: WorkflowStore, defaultProfile: () => string | undefined): void {
  ctx.inject(["connection", "webServer"], scope => {
    let queue: Promise<unknown> = Promise.resolve();
    const dispatch = (endpoint: string, payload: unknown, signal: AbortSignal): Promise<ConnectionRpcResult<unknown>> => {
      const operation = queue.then(async () => {
        signal.throwIfAborted();
        if (!["configurations", "profiles", "select-profile", "select-strategy"].includes(endpoint)) throw new Error("Unknown workflow endpoint");
        if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid workflow request");
        const value = payload as Record<string, unknown>;
        // Built-in configurations are package content and the stored layer is
        // already live in the Host, so a read needs no refresh control.
        if (endpoint === "configurations") {
          if (Object.keys(value).length > 0) throw new Error("Invalid workflow request");
          return { defaultConfig: defaultProfile() ?? null, ...catalog.view() };
        }
        const fields = endpoint === "profiles" ? ["sessionId"] : endpoint === "select-profile" ? ["sessionId", "profileId"] : ["sessionId", "strategy"];
        if (Object.keys(value).some(key => !fields.includes(key)) || typeof value.sessionId !== "string" || !value.sessionId) throw new Error("A native Session address is required; caller identities are not accepted");
        const id = SessionId(value.sessionId);
        const header = scope.sessions.get(id)?.header ?? (await scope.get("sessionPersistence")?.stat(id, { signal }))?.header;
        signal.throwIfAborted();
        if (header?.id !== id) throw new Error("Native Session is unavailable");
        const listed = catalog.view();
        if (endpoint === "select-profile") {
          if (typeof value.profileId !== "string" || !listed.configs.some(config => config.id === value.profileId)) throw new Error("Selected workflow profile is unavailable");
          store.selectProfile(id, value.profileId);
        } else if (endpoint === "select-strategy") {
          // Only coding strategies carry a Session override; integrate settings
          // are deployment-wide and have no Session scope.
          if (value.strategy !== null && !isStrategy(value.strategy)) throw new Error("Unknown workflow strategy");
          store.selectStrategy(id, value.strategy === null ? undefined : value.strategy as CodingStrategy);
        }
        return { selectedProfile: store.selectedProfile(id, defaultProfile()) ?? null, strategy: strategyView(catalog, store, id, defaultProfile), ...listed };
      });
      queue = operation.catch(() => {});
      return operation.then(value => ({ ok: true as const, value }), error => ({ ok: false as const,
        error: { code: "workflow/rejected", message: error instanceof Error ? error.message : String(error), details: {} } }));
    };
    const respond = (res: RpcResponse, status: number, body?: unknown): void => {
      if (body === undefined) { res.writeHead(status); res.end(); return; }
      const payload = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) });
      res.end(payload);
    };
    const envelope = (res: RpcResponse, status: number, rpcId: unknown, result: ConnectionRpcResult<unknown>): void => {
      respond(res, status, serverResponseSchema.parse({ type: "server-response",
        rpcId: typeof rpcId === "string" ? rpcId : INVALID_REQUEST_RPC_ID, result }));
    };
    scope.effect(() => scope.webServer.register({
      kind: "prefix",
      path: CHANNEL,
      handler: async (req: RpcRequest, res: RpcResponse) => {
        const connection: HostConnectionHandle = scope.connection;
        const rejection = connection.requestRejection(req);
        if (rejection !== undefined) { respond(res, rejection, rejection === 401 ? "unauthorized" : "forbidden"); return; }
        const endpoint = endpointOf(new URL(req.url ?? "/", "http://dsh.internal").pathname);
        if (req.method !== "POST" || endpoint === undefined) { respond(res, 404); return; }
        if (headerOf(req, "content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") { respond(res, 415); return; }
        const declaredLength = headerOf(req, "content-length");
        if (declaredLength !== undefined && Number(declaredLength) > MAX_REQUEST_BODY_BYTES) { respond(res, 413); return; }
        const chunks: Buffer[] = [];
        let received = 0;
        for await (const chunk of req) {
          received += (chunk as Buffer).byteLength;
          if (received > MAX_REQUEST_BODY_BYTES) { respond(res, 413); return; }
          chunks.push(chunk as Buffer);
        }
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { respond(res, 400, "body is not JSON"); return; }
        const parsed = clientRequestSchema.safeParse(body);
        if (!parsed.success) {
          envelope(res, 400, (body as { rpcId?: unknown } | null)?.rpcId, { ok: false,
            error: { code: "workflow/rejected", message: "Invalid workflow request envelope", details: {} } });
          return;
        }
        const message = parsed.data;
        if (message.method !== endpoint) {
          envelope(res, 200, message.rpcId, { ok: false,
            error: { code: "workflow/rejected", message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`, details: {} } });
          return;
        }
        envelope(res, 200, message.rpcId, await dispatch(endpoint, message.payload, req.signal ?? new AbortController().signal));
      },
    }), `dsh-workflow-kit: ${CHANNEL} rpc channel`);
  });
}
