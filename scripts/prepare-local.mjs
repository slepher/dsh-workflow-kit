import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));

/** Install the locked coordinated tarballs without rebuilding or modifying an execution owner. */
export function prepareLocal({ root = defaultRoot, run = spawnSync } = {}) {
  const tracked = [resolve(root, "package.json"), resolve(root, "package-lock.json")];
  const before = new Map(tracked.map(path => [path, readFileSync(path, "utf8")]));
  const manifest = JSON.parse(before.get(tracked[0]));
  for (const [name, spec] of Object.entries(manifest.devDependencies ?? {})) {
    if (!spec.startsWith("file:")) continue;
    if (!spec.endsWith(".tgz") || !existsSync(resolve(root, spec.slice(5)))) throw new Error(`Build and pack the coordinated dependency before preparation: ${name} (${spec})`);
  }
  try {
    const result = run(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm ci failed (${result.status ?? "signal"})`);
  } finally {
    for (const [path, contents] of before) if (readFileSync(path, "utf8") !== contents) throw new Error(`Local preparation modified ${path}`);
  }
  console.log("dsh-workflow-kit locked dependencies ready");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) prepareLocal();
