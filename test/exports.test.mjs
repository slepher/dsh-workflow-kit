import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";

import { WORKFLOW_OWNED_STATE, WORKFLOW_PLUGIN_ID } from "../lib/index.js";
const require = createRequire(import.meta.url);

test("exports the workflow boundary", () => {
  assert.equal(WORKFLOW_PLUGIN_ID, "dsh-workflow-kit");
  assert.equal(WORKFLOW_OWNED_STATE.includes("acceptance"), true);
  const client = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  const registrations = [];
  const document = { createElement: () => ({ remove() {} }), head: { append() {} } };
  runInNewContext(client, { document, window: { __ModuleLoader__: { load: value => registrations.push(value) } } });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, "dsh-workflow-kit");
  const plugin = registrations[0].factory(name => name === "@deepseek-ai/dsh-client-ui-primitives"
    ? {
        MarkdownText() {}, IconDatabaseOutline16() {}, IconClockOutline16() {}, IconGaugeOutline16() {},
        IconCopyOutline16() {}, IconCheckOutline16() {}, writeClipboard: async () => true,
        useAnchoredPosition: () => null, useAnchoredMaxHeight: () => 320, useDismissOnOutsidePointer() {},
      }
    : require(name));
  assert.equal(plugin.WORKFLOW_PLUGIN_ID, "dsh-workflow-kit");
  assert.equal(plugin.name, "dsh-workflow-kit");
  assert.equal(typeof plugin.apply, "function");

  const slots = [];
  const active = new Set(["foreign"]);
  const cleanup = [];
  plugin.apply({
      connection: { rpc: { call: async () => ({ ok: true, value: [] }) } },
      sidebarRight: {},
      sidebarRightTabs: { register: definition => {
        active.add(definition.id);
        return () => active.delete(definition.id);
      } },
      effect: effect => { const dispose = effect(); if (typeof dispose === "function") cleanup.push(dispose); },
      slots: {
        inject: (_name, register) => { const dispose = register(); cleanup.push(dispose); },
        register: (spec, component) => {
          slots.push({ spec, component });
          const id = spec.id ?? spec.key;
          active.add(id);
          return () => active.delete(id);
        },
      },
  });
  assert.deepEqual(slots.map(slot => slot.spec.name).sort(), [
    "conversation.session.header.utilities",
    "sidebar.right.pane.tab",
  ]);
  cleanup.reverse().forEach(dispose => dispose());
  assert.deepEqual([...active], ["foreign"]);
});
