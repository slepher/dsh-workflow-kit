import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertCombinationDependencies, assertHeadlessFiles, copyWorkflowSource } from "../scripts/headless-files.mjs";

const retired = /^(?:client|transcript|input-menu|stats|native-Toast|native-Tooltip|native-icons|native-stat-dialog|native-styles|transcript-styles|conversation|models|skills|rollout-usage)\./;

test("Workflow package remains headless and rejects stale generated UI artifacts", async () => {
  const files = readdirSync(new URL("../lib/", import.meta.url));
  assert.equal(files.some(file => retired.test(file)), false);
  assert.throws(() => assertHeadlessFiles([{ path: "lib/client.js" }]), /retired artifact: lib\/client\.js/);
  assert.doesNotThrow(() => assertHeadlessFiles(files.map(path => ({ path: `lib/${path}` }))));
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(manifest.exports), ["."]);
  await assert.rejects(import("dsh-workflow-kit/client"), error => error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED");
  const executable = readdirSync(new URL("../src/", import.meta.url)).filter(file => file.endsWith(".ts")).map(file => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(executable, /react|EventSource|__ModuleLoader__|\/codex-workers|sidebar\.right\.pane\.tab|conversation\.session\.header\.utilities/i);
});

test("B+W and B+C direct install sets reject unrelated packages", () => {
  assert.throws(() => assertCombinationDependencies("workflow", { "dsh-codex-kit": "file:ui.tgz" }), /UI dependency/);
  assert.throws(() => assertCombinationDependencies("workflow", { react: "18.3.1" }), /UI dependency/);
  assert.throws(() => assertCombinationDependencies("workflow", { "@deepseek-ai/dsh-client-connection": "0.1.5-rc.1" }), /UI dependency/);
  assert.throws(() => assertCombinationDependencies("codex", { "dsh-workflow-kit": "file:w.tgz" }), /includes Workflow/);
  assert.doesNotThrow(() => assertCombinationDependencies("workflow", { "dsh-codex-kit-backend": "file:b.tgz", "@deepseek-ai/dsh-tools": "0.1.5-rc.1" }));
});

test("clean W pack source ignores an active checkout lib and requires source", t => {
  const fixture = mkdtempSync(join(tmpdir(), "workflow-clean-source-")), build = join(fixture, "build");
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  for (const file of ["package.json", "package-lock.json", "tsconfig.json", "README.md", "cordis.patch.yml"]) writeFileSync(join(fixture, file), "{}");
  for (const directory of ["src", "scripts", "docs", "lib"]) mkdirSync(join(fixture, directory));
  writeFileSync(join(fixture, "src/index.ts"), "export {};");
  writeFileSync(join(fixture, "lib/index.js"), "CHECKOUT-STALE");
  copyWorkflowSource(fixture, build);
  assert.equal(existsSync(join(build, "src/index.ts")), true);
  assert.equal(existsSync(join(build, "lib/index.js")), false);
  rmSync(join(fixture, "src"), { recursive: true });
  assert.throws(() => copyWorkflowSource(fixture, join(fixture, "missing")), /src/);
});
