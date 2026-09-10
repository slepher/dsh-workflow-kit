import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("joint dev builds Codex first and launches one PATH dsh host", () => {
  const source = readFileSync(new URL("../scripts/dev.mjs", import.meta.url), "utf8");
  const ready = source.indexOf("dsh-codex-kit watch ready");
  const workflowBuild = source.indexOf('spawnSync("npm", ["run", "build"]');
  const host = source.indexOf('start("dsh", hostArgs)');
  assert.ok(ready >= 0 && workflowBuild > ready && host > workflowBuild);
  assert.equal(source.match(/start\("dsh"/g)?.length, 1);
  assert.match(source, /if \(!value \|\| value\.startsWith\("--"\)\)/);
  assert.match(source, /const patch = resolve\(value\)/);
  assert.match(source, /statSync\(patch\)\.isFile\(\)/);
  assert.match(source, /patchArgs\.push\("--patch", patch\)/);
  assert.match(source, /\["--profile", profile, "--no-open", "--port", "0", \.\.\.patchArgs\]/);
});

test("joint dev rejects a patch without a value before starting children", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/dev.mjs", import.meta.url)), "--patch"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--patch requires a file path/);
});

test("pack check installs all three tarballs without legacy peer bypass", () => {
  const source = readFileSync(new URL("../scripts/pack-check.mjs", import.meta.url), "utf8");
  for (const name of ["dsh-codex-kit-backend", "dsh-codex-kit", "dsh-workflow-kit"]) assert.match(source, new RegExp(`"${name}"`));
  assert.doesNotMatch(source, /legacy-peer-deps/);
});
