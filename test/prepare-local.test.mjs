import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareLocal } from "../scripts/prepare-local.mjs";

test("local preparation uses only the adjacent backend and preserves manifests", () => {
  const parent = mkdtempSync(join(tmpdir(), "dsh-workflow-prepare-test-"));
  const workflow = join(parent, "dsh-workflow-kit");
  const codex = join(parent, "dsh-codex-kit");
  const backend = join(codex, "packages/dsh-codex-kit-backend");
  mkdirSync(workflow); mkdirSync(backend, { recursive: true });
  const files = new Map([
    [join(workflow, "package.json"), JSON.stringify({ dependencies: { "dsh-codex-kit-backend": "0.1.0" } })],
    [join(workflow, "package-lock.json"), "{}"],
    [join(codex, "package.json"), "{}"],
    [join(codex, "package-lock.json"), "{}"],
    [join(backend, "package.json"), JSON.stringify({ name: "dsh-codex-kit-backend", version: "0.1.0" })],
  ]);
  for (const [path, contents] of files) writeFileSync(path, contents);
  const calls = [];
  try {
    prepareLocal({ root: workflow, run: (command, args, options) => { calls.push({ command, args, cwd: options.cwd }); return { status: 0 }; } });
    assert.deepEqual(calls.map(call => [call.args[0], call.cwd]), [["ci", codex], ["install", workflow], ["run", codex]]);
    assert.equal(calls[1].args.includes("--no-save"), true);
    assert.equal(calls[1].args.at(-1), backend);
    assert.doesNotMatch(calls.flatMap(call => call.args).join(" "), /(?:file|link):/);
    for (const [path, contents] of files) assert.equal(readFileSync(path, "utf8"), contents);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
