import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { WORKFLOW_OWNED_STATE, WORKFLOW_PLUGIN_ID } from "../lib/index.js";

test("exports the workflow boundary", () => {
  assert.equal(WORKFLOW_PLUGIN_ID, "dsh-workflow-kit");
  assert.equal(WORKFLOW_OWNED_STATE.includes("acceptance"), true);
  const client = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  const registrations = [];
  runInNewContext(client, { window: { __ModuleLoader__: { load: value => registrations.push(value) } } });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, "dsh-workflow-kit");
  assert.equal(registrations[0].factory(() => {}).WORKFLOW_PLUGIN_ID, "dsh-workflow-kit");
});
