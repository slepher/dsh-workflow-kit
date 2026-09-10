import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("joint dev builds Codex first and launches one PATH dsh host", () => {
  const source = readFileSync(new URL("../scripts/dev.mjs", import.meta.url), "utf8");
  const ready = source.indexOf("dsh-codex-kit watch ready");
  const workflowBuild = source.indexOf('spawnSync("npm", ["run", "build"]');
  const host = source.indexOf('start("dsh", ["--profile", profile, "--no-open", "--port", "0"]');
  assert.ok(ready >= 0 && workflowBuild > ready && host > workflowBuild);
  assert.equal(source.match(/start\("dsh"/g)?.length, 1);
});

test("pack check installs all three tarballs without legacy peer bypass", () => {
  const source = readFileSync(new URL("../scripts/pack-check.mjs", import.meta.url), "utf8");
  for (const name of ["dsh-codex-kit-backend", "dsh-codex-kit", "dsh-workflow-kit"]) assert.match(source, new RegExp(`"${name}"`));
  assert.doesNotMatch(source, /legacy-peer-deps/);
});
