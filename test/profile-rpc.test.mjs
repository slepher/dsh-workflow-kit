import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { installProfileRpc } from "../lib/profile-rpc.js";
import { fixture } from "./native-fixture.mjs";

test("profile RPC addresses real Sessions, isolates selections and preserves invalidated choices", async t => {
  const f = fixture(t);
  let handler;
  f.parent.session.header.id = "parent";
  const ctx = { sessions: f.ctx.sessions,
    inject(_services, apply) { apply(this); },
    get(name) { return name === "sessionPersistence" ? { async stat(id) { return id === "cold" ? { header: { id } } : undefined; } } : undefined; },
    connection: { rpc: { handle(channel, callback) { assert.equal(channel, "/workflow"); handler = callback; } } },
  };
  installProfileRpc(ctx, f.configuration, f.store, "a");
  const call = (action, payload) => handler(action, payload, new AbortController().signal);
  assert.equal((await call("profiles", { sessionId: "parent" })).value.selectedProfile, "a");
  assert.equal((await call("select-profile", { sessionId: "parent", profileId: "b" })).value.selectedProfile, "b");
  assert.equal((await call("profiles", { sessionId: "cold" })).value.selectedProfile, "a");
  assert.equal((await call("profiles", { sessionId: "missing" })).ok, false);
  assert.equal((await call("profiles", { sessionId: "parent", ownerId: "fake" })).ok, false);
  assert.equal((await call("select-profile", { sessionId: "parent", profileId: "missing" })).ok, false);
  rmSync(join(f.configuration.home, "config/profiles/b.json"));
  const invalidated = await call("reload-configuration", { sessionId: "parent" });
  assert.equal(invalidated.ok, true); assert.equal(invalidated.value.selectedProfile, "b");
  assert.equal(invalidated.value.profiles.some(profile => profile.id === "b"), false);
  assert.equal(f.calls.length, 0, "profile operations never start a model or create a child");
});

test("profile selections retain submission order across asynchronous Session validation", async t => {
  const f = fixture(t);
  let handler, release;
  const gate = new Promise(resolve => { release = resolve; });
  const ctx = { sessions: new Map(), inject(_services, apply) { apply(this); },
    get() { return { async stat(id) { await gate; return { header: { id } }; } }; },
    connection: { rpc: { handle(_channel, callback) { handler = callback; } } },
  };
  installProfileRpc(ctx, f.configuration, f.store, "a");
  const first = handler("select-profile", { sessionId: "cold", profileId: "b" }, new AbortController().signal);
  const second = handler("select-profile", { sessionId: "cold", profileId: "a" }, new AbortController().signal);
  release();
  assert.equal((await first).value.selectedProfile, "b"); assert.equal((await second).value.selectedProfile, "a");
  assert.equal(f.store.selectedProfile("cold"), "a");
});
