import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertCombinationDependencies, assertHeadlessFiles, copyWorkflowSource } from "../scripts/headless-files.mjs";

const retired = /^(?:transcript|input-menu|stats|native-Toast|native-Tooltip|native-icons|native-stat-dialog|native-styles|transcript-styles|conversation|models|skills|rollout-usage)\./;

test("Workflow Host stays headless while the same package exposes profile UI", async () => {
  const files = readdirSync(new URL("../lib/", import.meta.url));
  assert.equal(files.some(file => retired.test(file)), false);
  assert.doesNotThrow(() => assertHeadlessFiles([{ path: "lib/client.js" }]));
  assert.throws(() => assertHeadlessFiles([{ path: "lib/transcript.js" }]), /retired artifact/);
  assert.doesNotThrow(() => assertHeadlessFiles(files.map(path => ({ path: `lib/${path}` }))));
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(manifest.exports), [".", "./client"]);
  assert.ok(existsSync(new URL("../lib/client.js", import.meta.url)));
  const executable = readdirSync(new URL("../src/", import.meta.url)).filter(file => file.endsWith(".ts")).map(file => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(executable, /react|EventSource|__ModuleLoader__|\/codex-workers|sidebar\.right\.pane\.tab|conversation\.session\.header\.utilities/i);
});

test("provider and workflow install sets reject retired kit dependencies", () => {
  assert.throws(() => assertCombinationDependencies("workflow", { "dsh-codex-kit": "file:ui.tgz" }), /retired Codex kit dependency/);
  assert.doesNotThrow(() => assertCombinationDependencies("workflow", { react: "18.3.1" }));
  assert.throws(() => assertCombinationDependencies("workflow", { "dsh-codex-kit-backend": "file:old.tgz" }), /retired Codex kit dependency/);
  assert.throws(() => assertCombinationDependencies("provider", { "dsh-workflow-kit": "file:w.tgz" }), /includes Workflow/);
  assert.doesNotThrow(() => assertCombinationDependencies("workflow", { "dsh-codex-app-provider": "file:p.tgz", "@deepseek-ai/dsh-tools": "0.1.5-rc.1" }));
});

test("clean W pack source ignores an active checkout lib and requires source", t => {
  const fixture = mkdtempSync(join(tmpdir(), "workflow-clean-source-")), build = join(fixture, "build");
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  for (const file of ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.client.json", "README.md", "cordis.patch.yml"]) writeFileSync(join(fixture, file), "{}");
  for (const directory of ["src", "scripts", "docs", "profiles", "lib"]) mkdirSync(join(fixture, directory));
  writeFileSync(join(fixture, "src/index.ts"), "export {};");
  writeFileSync(join(fixture, "profiles/gpt-workflow.json"), "{}");
  writeFileSync(join(fixture, "lib/index.js"), "CHECKOUT-STALE");
  copyWorkflowSource(fixture, build);
  assert.equal(existsSync(join(build, "src/index.ts")), true);
  // Shipped configurations travel with the source, never with a stale checkout lib.
  assert.equal(existsSync(join(build, "profiles/gpt-workflow.json")), true);
  assert.equal(existsSync(join(build, "lib/index.js")), false);
  rmSync(join(fixture, "src"), { recursive: true });
  assert.throws(() => copyWorkflowSource(fixture, join(fixture, "missing")), /src/);
});
