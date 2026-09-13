import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareLocal } from "../scripts/prepare-local.mjs";

test("local preparation installs locked tarballs, preserves manifests and never rebuilds an owner", t => {
  const parent = mkdtempSync(join(tmpdir(), "dsh-workflow-prepare-test-")), root = join(parent, "workflow");
  t.after(() => rmSync(parent, { recursive: true, force: true })); mkdirSync(root);
  const manifest = JSON.stringify({ devDependencies: { "dsh-codex-app-provider": "file:../provider.tgz" } });
  writeFileSync(join(root, "package.json"), manifest); writeFileSync(join(root, "package-lock.json"), "{}");
  const calls = [], run = (command, args, options) => { calls.push({ command, args, cwd: options.cwd }); return { status: 0 }; };
  assert.throws(() => prepareLocal({ root, run }), /Build and pack/); assert.equal(calls.length, 0);
  writeFileSync(join(parent, "provider.tgz"), "fixture tarball");
  prepareLocal({ root, run });
  assert.equal(calls.length, 1); assert.equal(calls[0].cwd, root); assert.equal(calls[0].args[0], "ci");
  assert.equal(readFileSync(join(root, "package.json"), "utf8"), manifest);
  assert.equal(readFileSync(join(root, "package-lock.json"), "utf8"), "{}");
});
