import assert from "node:assert/strict";
import test from "node:test";
import { Context, Service } from "@deepseek-ai/cordis";
import { HostConnectionService } from "@deepseek-ai/dsh-client-connection";
import { installProfileRpc } from "../lib/profile-rpc.js";
import { fixture } from "./native-fixture.mjs";

// This harness pins a regression a plain object stub cannot see: registering the
// channel through `connection.rpc.handle` reads the webServer from the Connection
// service's own fiber, which declares only `webRuntime`, so the registration
// throws and `/workflow` never mounts (HTTP 405).
class WebServerStub extends Service {
  prefixes = new Map();
  constructor(ctx) { super(ctx, "webServer"); }
  register(route) {
    if (this.prefixes.has(route.path)) throw new Error(`duplicate ${route.kind} route ${route.path}`);
    this.prefixes.set(route.path, route);
    return () => this.prefixes.delete(route.path);
  }
}
class SimpleStub extends Service {
  constructor(ctx, name) { super(ctx, name); }
}
class SessionsStub extends Service {
  constructor(ctx, sessions) { super(ctx, "sessions"); this.sessions = sessions; }
  get(id) { return this.sessions.get(id); }
}
class SessionPersistenceStub extends Service {
  constructor(ctx) { super(ctx, "sessionPersistence"); }
  async stat(id) { return id === "cold" ? { header: { id } } : undefined; }
}

/** Compose a real Cordis tree with stub Web/Connection carriers for these tests. */
async function harness(f) {
  const app = new Context();
  await app.plugin({ name: "web-startup", apply: ctx => { ctx.provide("webStartup", {}); } });
  await app.plugin({ name: "webserver", inject: ["webStartup"], apply: ctx => { new WebServerStub(ctx); } });
  await app.plugin({ name: "web-runtime", inject: ["webServer"], apply: ctx => { ctx.provide("webRuntime", { trustedHosts: [] }); } });
  await app.plugin({ name: "connection", inject: ["webRuntime"], apply: ctx => { new HostConnectionService(ctx, [], { isAuthenticated: () => true }); } });
  for (const name of ["tools", "agents", "subagents", "codexExecution"]) {
    await app.plugin({ name: `${name}-stub`, apply: ctx => { new SimpleStub(ctx, name); } });
  }
  await app.plugin({ name: "sessions-stub", apply: ctx => { new SessionsStub(ctx, f.ctx.sessions); } });
  await app.plugin({ name: "session-persistence-stub", apply: ctx => { new SessionPersistenceStub(ctx); } });
  const fiber = app.inject(["tools", "agents", "sessions", "subagents", "codexExecution"],
    ctx => installProfileRpc(ctx, f.configuration, f.store, () => "a"));
  await fiber;
  return { app, fiber, route: app.get("webServer").prefixes.get("/workflow") };
}

/** One node:http-shaped request whose body yields the given envelope. */
function request(body, { method = "POST", url, headers = { "content-type": "application/json", host: "127.0.0.1:3080" } } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const target = url ?? `/workflow/${typeof body === "object" && body !== null ? String(body.method) : "profiles"}`;
  return { method, url: target, headers, signal: undefined,
    async *[Symbol.asyncIterator]() { yield Buffer.from(text); } };
}
/** Capture one node:http-shaped response. */
function response() {
  const captured = { status: undefined, headers: undefined, body: "" };
  return { captured, writeHead(status, headers) { captured.status = status; captured.headers = headers; }, end(body) { captured.body = body ?? ""; } };
}
const call = (route, body, options) => {
  const res = response();
  return Promise.resolve(route.handler(request(body, options), res))
    .then(() => ({ ...res.captured, json: res.captured.body === "" ? undefined : JSON.parse(res.captured.body) }));
};
const envelope = (method, payload, rpcId = "test-id") => ({ type: "client-request", rpcId, method, payload });

test("workflow profile channel mounts on the real fiber and answers carrier requests", async t => {
  const f = fixture(t);
  f.parent.session.header.id = "parent";
  const { app, route } = await harness(f);
  assert.ok(route, "the /workflow prefix route is registered on the Web server");
  assert.equal(route.kind, "prefix");

  const profiles = await call(route, envelope("profiles", { sessionId: "parent" }));
  assert.equal(profiles.status, 200);
  assert.equal(profiles.headers["content-type"], "application/json");
  assert.equal(profiles.json.type, "server-response");
  assert.equal(profiles.json.rpcId, "test-id");
  assert.equal(profiles.json.result.value.selectedProfile, "a");

  // The settings page reads the catalog with no Session at all.
  const configurations = await call(route, envelope("configurations", {}));
  assert.equal(configurations.json.result.ok, true);
  assert.equal(configurations.json.result.value.defaultConfig, "a");
  assert.equal(configurations.json.result.value.roleNames.length, 7);
  assert.deepEqual(configurations.json.result.value.strategies, { coding: "adaptive", integrate: "economy" });
  assert.equal((await call(route, envelope("configurations", { sessionId: "parent" }))).json.result.ok, false);

  // Session coding strategy: an override is recorded per Session, and clearing
  // it restores the stored default without touching the integrate setting.
  const strategy = await call(route, envelope("select-strategy", { sessionId: "parent", strategy: "expert" }));
  assert.deepEqual(strategy.json.result.value.strategy,
    { preference: "expert", default: "adaptive", effective: "independent", sameModel: false, fixed: false });
  assert.equal(f.store.strategyPreference("parent"), "expert");
  assert.deepEqual(f.configuration.strategies(), { coding: "adaptive", integrate: "economy" }, "a Session override never rewrites the stored defaults");
  assert.equal((await call(route, envelope("select-strategy", { sessionId: "parent", strategy: "turbo" }))).json.result.ok, false);
  assert.equal((await call(route, envelope("select-strategy", { sessionId: "parent" }))).json.result.ok, false, "the strategy field is required");
  const cleared = await call(route, envelope("select-strategy", { sessionId: "parent", strategy: null }));
  assert.equal(cleared.json.result.value.strategy.preference, null);
  assert.equal(cleared.json.result.value.strategy.effective, "adaptive");
  assert.equal(f.store.strategyPreference("parent"), undefined);

  const selected = await call(route, envelope("select-profile", { sessionId: "parent", profileId: "b" }));
  assert.equal(selected.json.result.value.selectedProfile, "b");
  assert.equal(f.store.selectedProfile("parent"), "b");

  // Cold Session validation reads sessionPersistence instead of the live Session map.
  const cold = await call(route, envelope("profiles", { sessionId: "cold" }));
  assert.equal(cold.json.result.value.selectedProfile, "a");

  assert.equal((await call(route, envelope("profiles", { sessionId: "missing" }))).json.result.ok, false);
  assert.equal((await call(route, envelope("select-profile", { sessionId: "parent", profileId: "missing" }))).json.result.ok, false);
  assert.equal((await call(route, envelope("profiles", { sessionId: "parent", ownerId: "fake" }))).json.result.ok, false);
  // Built-in configurations are package content, so the catalog is stable and
  // the Session keeps the selection it recorded.
  const reread = await call(route, envelope("profiles", { sessionId: "parent" }));
  assert.equal(reread.json.result.ok, true);
  assert.equal(reread.json.result.value.selectedProfile, "b");
  assert.deepEqual(reread.json.result.value.configs.map(config => config.id), ["a", "b"]);
  assert.equal(f.calls.length, 0, "profile operations never start a model or create a child");
});

test("workflow profile channel keeps connection carrier semantics", async t => {
  const f = fixture(t);
  f.parent.session.header.id = "parent";
  const { route } = await harness(f);

  assert.equal((await call(route, envelope("profiles", { sessionId: "parent" }), { method: "GET" })).status, 404);
  assert.equal((await call(route, envelope("profiles", { sessionId: "parent" }), { url: "/workflow" })).status, 404);
  assert.equal((await call(route, envelope("profiles", { sessionId: "parent" }), { headers: { host: "127.0.0.1:3080" } })).status, 415);
  // A path that is not the channel's `POST /workflow/<endpoint>` shape never dispatches a known endpoint.
  const nested = await call(route, envelope("profiles", { sessionId: "parent" }), { url: "/workflow/unknown/segment" });
  assert.equal(nested.json.result.ok, false);
  const mismatched = await call(route, envelope("profiles", { sessionId: "parent" }), { url: "/workflow/configurations" });
  assert.equal(mismatched.status, 200);
  assert.equal(mismatched.json.result.ok, false);
  assert.match(mismatched.json.result.error.message, /does not match endpoint/);
  assert.equal((await call(route, "not json")).status, 400);
  const badEnvelope = await call(route, { rpcId: "keep-me", method: "profiles" });
  assert.equal(badEnvelope.status, 400);
  assert.equal(badEnvelope.json.rpcId, "keep-me");
  const forbidden = await call(route, envelope("profiles", { sessionId: "parent" }), { headers: { "content-type": "application/json", host: "attacker.example" } });
  assert.ok(forbidden.status === 401 || forbidden.status === 403, `untrusted host rejected, got ${forbidden.status}`);
});

test("profile selections retain submission order across asynchronous Session validation", async t => {
  const f = fixture(t);
  let handler, release;
  const gate = new Promise(resolve => { release = resolve; });
  const ctx = { sessions: new Map(), inject(_services, apply) { apply(this); }, effect(register) { return register(); },
    get() { return { async stat(id) { await gate; return { header: { id } }; } }; },
    connection: { requestRejection() { return undefined; } },
    webServer: { register(route) { handler = (endpoint, payload, signal) => route.handler(
      { method: "POST", url: `/workflow/${endpoint}`, headers: { "content-type": "application/json", host: "127.0.0.1:3080" }, signal,
        async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(envelope(endpoint, payload))) } },
      { writeHead() {}, end() {} }); return () => {}; } },
  };
  installProfileRpc(ctx, f.configuration, f.store, () => "a");
  const first = handler("select-profile", { sessionId: "cold", profileId: "b" }, new AbortController().signal);
  const second = handler("select-profile", { sessionId: "cold", profileId: "a" }, new AbortController().signal);
  release();
  await Promise.all([first, second]);
  assert.equal(f.store.selectedProfile("cold"), "a");
});

test("disposing the workflow fiber releases the channel", async t => {
  const f = fixture(t);
  const { app, fiber } = await harness(f);
  assert.ok(app.get("webServer").prefixes.has("/workflow"));
  await fiber.dispose();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(app.get("webServer").prefixes.has("/workflow"), false, "the route leaves with its owning fiber");
});
