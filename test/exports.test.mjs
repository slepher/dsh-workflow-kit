import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { WORKFLOW_OWNED_STATE, WORKFLOW_PLUGIN_ID } from "../lib/index.js";

test("exports the workflow boundary", () => {
  assert.equal(WORKFLOW_PLUGIN_ID, "dsh-workflow-kit");
  assert.equal(WORKFLOW_OWNED_STATE.includes("acceptance"), true);
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const lock = readFileSync(new URL("../package-lock.json", import.meta.url), "utf8");
  assert.deepEqual(Object.keys(manifest.exports).sort(), [".", "./client"]);
  assert.ok(manifest.files.includes("lib") && manifest.files.includes("cordis.patch.yml"));
  assert.equal("client" in manifest.dsh, false, "Workflow has no browser activation row during B4p");
  assert.equal(manifest.dependencies["dsh-codex-kit-backend"], "0.1.0");
  assert.equal("dsh-codex-kit-backend" in manifest.devDependencies, false);
  assert.doesNotMatch(JSON.stringify(manifest) + lock, /file:\.\.\/dsh-codex-kit|\/tmp\/|\/home\//);
  assert.equal(JSON.parse(lock).packages["node_modules/dsh-codex-kit-backend"].version, "0.1.0");
  assert.equal("dsh-codex-kit" in manifest.dependencies, false);
  const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
  assert.match(patch, /id: dsh-workflow-kit\s+name: dsh-workflow-kit/);
});
