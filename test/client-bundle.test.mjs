import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

/**
 * Platform identities the shell's module table seeds for every dynamic half.
 * They are stubbed rather than resolved from this checkout: this suite asserts
 * registrations, so it must not depend on another package's dependency tree.
 */
const snapshotStore = (initial) => {
  let state = initial;
  return { getSnapshot: () => state, set(next) { state = next; }, subscribe: () => () => {} };
};
const PLATFORM = {
  "react": { useState: value => [value, () => {}], useEffect: () => {}, useRef: () => ({ current: null }) },
  "react/jsx-runtime": { jsx: () => null, jsxs: () => null, Fragment: {} },
  "react-dom": { createPortal: () => null },
  "react-dom/client": {},
  "@deepseek-ai/dsh-client-store": { createSnapshotStore: snapshotStore },
  "@deepseek-ai/dsh-client-ui-primitives": {
    Button: () => null, Input: () => null, Menu: () => null, Modal: () => null,
    Tooltip: () => null, Pill: () => null,
    useAnchoredPosition: () => null, useDismissOnOutsidePointer: () => {},
    IconBranchOutline16: () => null, IconChevronDownOutline14: () => null,
    IconChevronRightOutline14: () => null, IconCheckOutline14: () => null,
  },
};

/**
 * Load the shipped client half the way the DSH module loader does, with only
 * the platform identities resolvable from this checkout.
 * @returns the plugin module the bundle exports.
 */
function loadBundle() {
  let plugin;
  runInNewContext(readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"), {
    window: {
      __ModuleLoader__: {
        load(value) {
          assert.equal(value.id, "dsh-workflow-kit");
          plugin = value.factory(name => {
            assert.ok(Object.hasOwn(PLATFORM, name), `bundle requested a non-platform module: ${name}`);
            return PLATFORM[name];
          });
        },
      },
    },
  });
  return plugin;
}

/** Detach a value built inside the vm realm so deep comparison sees host prototypes. */
const detached = value => JSON.parse(JSON.stringify(value));

/** One model catalog answer shaped like the Host's `session/modelCatalog`. */
const catalogValue = {
  groups: [{
    id: "deepseek-official",
    name: "DeepSeek",
    models: [{ id: "deepseek-flash", name: "DeepSeek-V41-Flash", reasoning: { efforts: [{ id: "high", name: "High" }] } }],
  }],
  failures: [],
};

/** Compose the client context the shipped half expects, recording every observable effect. */
function harness() {
  const calls = [], mutations = [], rows = [], effects = [];
  let catalogReads = 0;
  const connection = {
    rpc: {
      call(path, method, payload) {
        calls.push({ path, method, payload });
        return Promise.resolve({ ok: true, value: { selectedProfile: null, defaultConfig: null, configs: [], roleNames: [] } });
      },
    },
  };
  const scope = {
    getSnapshot: () => ({ status: "ready", writable: true, revision: 7, mode: "host", value: undefined, base: undefined, user: undefined }),
    subscribe: () => () => {},
    mutate: ops => { mutations.push(ops); return Promise.resolve(); },
  };
  const ctx = {
    get: name => { assert.equal(name, "connection"); return connection; },
    effect(fn) {
      const result = fn();
      if (typeof result === "function") effects.push(result);
      return () => {};
    },
    locale: {
      register(ns) { assert.equal(ns, "dsh-workflow-kit"); return () => {}; },
      bind: () => key => (key === "nav" ? "工作流" : key),
    },
    settingsScope: { bind(spec) { assert.equal(spec.namespace, "dsh-workflow-kit"); return scope; } },
    remote: { session: { modelCatalog: () => { catalogReads += 1; return Promise.resolve({ ok: true, value: catalogValue }); } } },
    slots: {
      inject(_name, fn) { fn(); return () => {}; },
      register(row) { rows.push(row); return () => {}; },
    },
  };
  return { ctx, calls, mutations, rows, effects, scope, catalogReads: () => catalogReads };
}

test("shipped client registers the composer picker and the Workflow settings page", async () => {
  const plugin = loadBundle();
  const { ctx, calls, mutations, rows, effects, catalogReads } = harness();
  // `remote.session` is a separate injection from `remote`: without it the
  // settings page cannot read the adapter model catalog.
  assert.deepEqual([...plugin.inject].sort(),
    ["connection", "locale", "remote", "remote.session", "settingsScope", "slots"]);
  plugin.apply(ctx);
  assert.equal(catalogReads(), 1, "the settings page reads the adapter model catalog");

  assert.deepEqual(rows.map(row => row.name).sort(), ["conversation.input.left", "settings.section"]);

  const picker = rows.find(row => row.name === "conversation.input.left");
  assert.equal(picker.id, "workflow-config");
  assert.equal(picker.locale, "dsh-workflow-kit");
  const face = picker.inject();
  assert.deepEqual(Object.keys(face), ["request"]);
  await face.request("parent", "profiles");
  assert.deepEqual(detached(calls.at(-1)), { path: "/workflow", method: "profiles", payload: { sessionId: "parent" } });
  await face.request("parent", "select-profile", "gpt-workflow");
  assert.deepEqual(detached(calls.at(-1)), { path: "/workflow", method: "select-profile", payload: { sessionId: "parent", profileId: "gpt-workflow" } });

  const section = rows.find(row => row.name === "settings.section");
  assert.equal(section.id, "workflow");
  // Ordered after every routine settings page.
  assert.equal(section.order, 50);
  assert.equal(section.label(), "工作流");
  const settings = section.inject();
  assert.equal(typeof settings.hooks.workflowSettings.getSnapshot, "function");
  assert.equal(typeof settings.hooks.workflowSettings.subscribe, "function");
  await settings.setRole("gpt-workflow", "planner", { provider: "codex", model: "gpt-6-astra", reasoningEffort: "high" });
  assert.deepEqual(detached(mutations.at(-1)), [{ op: "set", path: ["configs", "gpt-workflow", "roles", "planner"],
    value: { provider: "codex", model: "gpt-6-astra", reasoningEffort: "high" } }]);
  await settings.setDefault("ds-workflow");
  assert.deepEqual(detached(mutations.at(-1)), [{ op: "set", path: ["defaultConfig"], value: "ds-workflow" }]);
  await settings.resetConfig("gpt-workflow");
  assert.deepEqual(detached(mutations.at(-1)), [{ op: "unset", path: ["configs", "gpt-workflow"] }]);

  for (const dispose of effects) dispose();
});

test("shipped client styles use native tokens and paint the settings-nav glyph", () => {
  const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  for (const token of [/--dsw-alias-bg-module-platform/, /--dsw-alias-interactive-bg-hover/,
    /--dsw-alias-border-l2/, /--dsw-alias-label-tertiary/, /--dsw-alias-label-error/]) {
    assert.match(source, token, `token ${String(token)} is missing`);
  }
  assert.match(source, /data-plugin-css/);
  // The shell chooses settings-nav glyphs from built-in ids, so the plugin marks
  // its own row and paints the branch icon itself.
  assert.ok(source.includes("data-dsh-workflow-kit-settings-nav"));
  assert.ok(source.includes("M13.0762 1.37207"), "the branch glyph path is inlined as a mask");
  assert.match(source, /mask:\s*url\("data:image\/svg\+xml/);
  // The picker is a menu card, not a native select popup.
  assert.ok(source.includes('"aria-haspopup"'));
  assert.ok(!source.includes("<select"), "the native select popup is gone");
  // Models are grouped under their provider heading, the way the composer's own
  // model seat lists them, rather than flattened into "model · provider" rows.
  assert.ok(source.includes('"wf-group-title"'), "provider headings are rendered");
  assert.ok(source.includes('role: "group"'), "each provider group is a labelled section");
  assert.ok(source.includes('"wf-item-check"'), "the selected route carries a check");
  assert.match(source, /--dsw-specific-menu/);
});
