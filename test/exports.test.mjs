import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { WORKFLOW_OWNED_STATE, WORKFLOW_PLUGIN_ID } from "../lib/index.js";

test("exports the workflow boundary", () => {
  assert.equal(WORKFLOW_PLUGIN_ID, "dsh-workflow-kit");
  assert.deepEqual(WORKFLOW_OWNED_STATE, ["tasks", "attempts", "lanes", "reviews", "integration", "delivery", "release"]);
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const lock = readFileSync(new URL("../package-lock.json", import.meta.url), "utf8");
  // `./package.json` and `./locale/*.json` are display resources: the Plugin
  // Manager reads a plugin's title and description through them without
  // evaluating plugin code. They widen no runtime API.
  assert.deepEqual(Object.keys(manifest.exports), [".", "./client", "./package.json", "./locale/*.json"]);
  assert.ok(manifest.files.includes("locale/*.json"), "the locale resources ship with the package");
  assert.ok(manifest.files.includes("lib") && manifest.files.includes("profiles") && manifest.files.includes("cordis.patch.yml"));
  assert.equal(manifest.exports["./client"].default, "./lib/client.js");
  assert.equal(manifest.dsh.client.platform, "web");
  assert.equal("dsh-codex-kit-backend" in manifest.dependencies, false);
  assert.equal(manifest.peerDependencies["dsh-codex-app-provider"], "0.1.0");
  assert.equal("dsh-codex-kit-backend" in manifest.devDependencies, false);
  assert.doesNotMatch(JSON.stringify(manifest) + lock, /file:\.\.\/dsh-codex-kit|\/tmp\/|\/home\//);
  assert.equal(JSON.parse(lock).packages["node_modules/dsh-codex-kit-backend"], undefined);
  assert.equal("dsh-codex-kit" in manifest.dependencies, false);
  assert.equal(manifest.peerDependenciesMeta.react.optional, true);
  // The Host half imports the connection request/response schemas at runtime, so
  // this peer must stay installable; marking it optional left an isolated
  // consumer without the package and failed at import time.
  assert.equal(manifest.peerDependenciesMeta["@deepseek-ai/dsh-client-connection"], undefined);
  const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
  assert.match(patch, /id: dsh-workflow-kit\s+name: dsh-workflow-kit/);
});
