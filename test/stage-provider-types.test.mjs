import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stageProviderTypes } from "../scripts/stage-provider-types.mjs";

test("staging places one built provider checkout inside this package's own modules", t => {
  const parent = mkdtempSync(join(tmpdir(), "dsh-workflow-stage-test-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, "workflow"), checkout = join(parent, "provider");
  mkdirSync(join(root, "node_modules"), { recursive: true });
  mkdirSync(join(checkout, "lib"), { recursive: true });
  writeFileSync(join(checkout, "package.json"), JSON.stringify({
    name: "dsh-codex-app-provider", version: "0.1.1", type: "module",
    main: "lib/index.js", types: "lib/index.d.ts",
    exports: { ".": { types: "./lib/index.d.ts", default: "./lib/index.js" } },
  }));
  writeFileSync(join(checkout, "lib", "index.d.ts"), "export interface NativeExecution {}\n");
  writeFileSync(join(checkout, "lib", "index.js"), "export {};\n");

  // An unbuilt checkout cannot be staged: the copy would resolve no declarations,
  // and that failure would surface much later as an unrelated type error.
  assert.throws(() => stageProviderTypes({ root, checkout: join(parent, "missing"), log() {} }), /Build the Codex provider/);

  const target = stageProviderTypes({ root, checkout, log() {} });
  assert.equal(target, join(root, "node_modules", "dsh-codex-app-provider"));
  assert.ok(existsSync(join(target, "lib", "index.d.ts")), "the declarations the type checker reads are staged");
  assert.ok(existsSync(join(target, "lib", "index.js")), "the built entry points come along");
  // Only the fields module resolution reads: the staged copy is an input to the
  // type checker, never a dependency anyone imports at runtime.
  const staged = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(staged).sort(), ["exports", "main", "name", "type", "types", "version"]);
  // Staging is idempotent: `prepare:local` may run over an already-staged tree.
  assert.equal(stageProviderTypes({ root, checkout, log() {} }), target);
});
