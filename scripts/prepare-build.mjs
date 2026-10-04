// Self-contained build for a git install.
//
// pnpm runs `prepare` after fetching this repository, inside a copy with
// nothing beside it: no sibling checkout, and none of the declarations a type
// checker needs. `npm run build` cannot serve that path — it compiles with
// `tsc`, which resolves `dsh-codex-app-provider` — so this script emits the
// entry points the Loader actually reads, by transpiling only:
//
//   src/prompts/*.md -> src/generated/prompts.ts
//   src/**/*.ts      -> lib/**/*.js   (esbuild, no type checking)
//   src/client/**    -> lib/client.js (esbuild bundle)
//
// Development keeps `npm run build`, which additionally type-checks and emits
// declarations. Those declarations are a development and publishing concern:
// nothing in the Harness reads them at load time, so a git install omits them.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "src");
const client = join(source, "client");
const output = join(root, "lib");

/** Every TypeScript module of the Host half, in a stable order, excluding the browser half. */
function hostModules(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (path !== client) found.push(...hostModules(path));
      continue;
    }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) found.push(path);
  }
  return found;
}

/** Run one package-internal build step, failing this build if it fails. */
function step(script) {
  const result = spawnSync(process.execPath, [join(root, "scripts", script)], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed (${result.status ?? "signal"})`);
}

step("build-skills.mjs");
await build({
  entryPoints: hostModules(source),
  outdir: output,
  outbase: source,
  // The Host half is a module graph, not a bundle: each module keeps its own
  // file and its imports, so nothing is duplicated or silently inlined.
  bundle: false,
  format: "esm",
  platform: "node",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
});
step("build-client.mjs");

for (const entry of ["index.js", "client.js"]) {
  if (!existsSync(join(output, entry))) throw new Error(`prepare produced no lib/${entry}`);
}
console.log("dsh-workflow-kit prepared for a git install");
