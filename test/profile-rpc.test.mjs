import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { Context, Service } from "@deepseek-ai/cordis";
import { HostConnectionService } from "@deepseek-ai/dsh-client-connection";
import { installProfileRpc } from "../lib/profile-rpc.js";
import { fixture } from "./native-fixture.mjs";

class WebServerStub extends Service {
  prefixes = new Map();
  constructor(ctx) { super(ctx, "webServer"); }
  register(route) {
    assert.equal(this.prefixes.has(route.path), false);
    this.prefixes.set(route.path, route);
    return () => this.prefixes.delete(route.path);
  }
}

/** Use real HTTP messages and the published Connection bridge, including response cancellation. */
async function harness(t, f) {
  const app = new Context();
  await app.plugin({ name: "web-server", apply: ctx => { new WebServerStub(ctx); } });
  // Match the published Connection plugin: no direct webServer dependency.
  await app.plugin({ name: "connection", apply: ctx => {
    new HostConnectionService(ctx, [], {
      isAuthenticated: req => req.headers.cookie === "test-owner",
      authenticateApi: () => undefined,
    });
  } });
  app.provide("sessions", f.ctx.sessions);
  app.provide("sessionPersistence", { async stat(id) { return id === "cold" ? { header: { id } } : undefined; } });
  const fiber = app.inject(["sessions"], ctx => installProfileRpc(ctx, f.configuration, f.store, () => "a"));
  await fiber;
  const server = createServer((req, res) => {
    const route = app.webServer.prefixes.get("/workflow");
    if (route === undefined || !req.url.startsWith("/workflow")) { res.writeHead(405); res.end(); return; }
    route.handler(req, res).catch(error => { res.writeHead(500); res.end(String(error)); });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await app.fiber.dispose(); });
  return { app, fiber, route: { kind: "prefix", base: `http://127.0.0.1:${server.address().port}` } };
}

async function call(route, body, { method = "POST", url, headers = {} } = {}) {
  const endpoint = url ?? `/workflow/${typeof body === "object" && body !== null ? String(body.method) : "profiles"}`;
  const response = await fetch(route.base + endpoint, { method,
    headers: { "content-type": "application/json", cookie: "test-owner", ...headers },
    ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { /* Carrier errors may be plain text. */ }
  return { status: response.status, headers: Object.fromEntries(response.headers), json };
}
const envelope = (method, payload, rpcId = "test-id") => ({ type: "client-request", rpcId, method, payload });

test("workflow profile channel mounts on the real fiber and answers carrier requests", async t => {
  const f = fixture(t);
  f.parent.session.header.id = "parent";
  const { app, route } = await harness(t, f);
  assert.ok(app.webServer.prefixes.has("/workflow"), "the route mounts without a webServer dependency on Connection");
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

  // The composer records only the Profile: the coding strategy is a settings
  // value now, and the retired per-Session endpoint is refused.
  assert.equal((await call(route, envelope("select-strategy", { sessionId: "parent", strategy: "expert" }))).json.result.ok, false);
  const profilesView = await call(route, envelope("profiles", { sessionId: "parent" }));
  assert.deepEqual(profilesView.json.result.value.strategy, { default: "adaptive", effective: "adaptive", sameModel: false });

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


test("Connection rejects unauthenticated requests and malformed carrier input", async t => {
  const f = fixture(t);
  const { route } = await harness(t, f);
  assert.equal((await call(route, envelope("configurations", {}), { headers: { cookie: "" } })).status, 401);
  assert.equal((await call(route, envelope("configurations", {}), { method: "GET" })).status, 404);
  assert.equal((await call(route, "not json")).status, 400);
  assert.equal((await call(route, { rpcId: "keep-me" })).json.result.ok, false);
  const mismatch = await call(route, envelope("configurations", {}), { url: "/workflow/profiles" });
  assert.equal(mismatch.json.result.ok, false);
  assert.match(mismatch.json.result.error.message, /does not match endpoint/);
});

test("only owner requests enter the ordered configuration queue", async t => {
  const f = fixture(t);
  let handler, release;
  const gate = new Promise(resolve => { release = resolve; });
  const ctx = { sessions: new Map(), inject(_services, apply) { apply(this); }, effect(register) { return register(); },
    get() { return { async stat(id) { await gate; return { header: { id } }; } }; },
    connection: { admit(req) { return { peer: { principal: { kind: req.principal } } }; } },
    webServer: { register(route) { handler = async (endpoint, payload, signal, peer) => {
      const body = Buffer.from(JSON.stringify(envelope(endpoint, payload)));
      const req = { principal: peer.principal.kind, method: "POST", url: `/workflow/${endpoint}`,
        headers: { "content-type": "application/json" }, signal: AbortSignal.abort(),
        async *[Symbol.asyncIterator]() { yield body; } };
      let status, result;
      const res = { writableEnded: false, on(_event, listener) { if (signal.aborted) listener(); },
        writeHead(value) { status = value; }, end(value) { result = value; this.writableEnded = true; } };
      await route.handler(req, res);
      if (status === 403) return { ok: false, error: { code: "workflow/forbidden" } };
      if (status === 413) return { ok: false, error: { code: "HTTP_413" } };
      return JSON.parse(result).result;
    }; return () => {}; } },
  };
  installProfileRpc(ctx, f.configuration, f.store, () => "a");
  const signal = new AbortController().signal, owner = { principal: { kind: "owner" } };
  const forbidden = await handler("select-profile", { sessionId: "cold", profileId: "b" }, signal, { principal: { kind: "agent" } });
  assert.equal(forbidden.error.code, "workflow/forbidden");
  assert.equal(f.store.selectedProfile("cold"), undefined);
  const oversized = await handler("profiles", { sessionId: "x".repeat(8 * 1024 * 1024) }, signal, owner);
  assert.equal(oversized.error.code, "HTTP_413");
  const first = handler("select-profile", { sessionId: "cold", profileId: "b" }, signal, owner);
  const second = handler("select-profile", { sessionId: "cold", profileId: "a" }, signal, owner);
  release();
  assert.ok((await first).ok && (await second).ok);
  assert.equal(f.store.selectedProfile("cold"), "a");
  const aborted = await handler("select-profile", { sessionId: "cold", profileId: "b" }, AbortSignal.abort(), owner);
  assert.equal(aborted.ok, false);
  assert.equal(f.store.selectedProfile("cold"), "a");
});

test("disposing the workflow fiber releases the Connection channel", async t => {
  const f = fixture(t);
  const { app, fiber } = await harness(t, f);
  assert.ok(app.webServer.prefixes.has("/workflow"));
  await fiber.dispose();
  assert.equal(app.webServer.prefixes.has("/workflow"), false);
});
