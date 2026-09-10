import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));

export function prepareLocal({ root = defaultRoot, run = spawnSync } = {}) {
  const codex = resolve(root, "../dsh-codex-kit");
  const backend = resolve(codex, "packages/dsh-codex-kit-backend");
  const tracked = [
    resolve(root, "package.json"),
    resolve(root, "package-lock.json"),
    resolve(codex, "package.json"),
    resolve(codex, "package-lock.json"),
  ];
  const before = new Map(tracked.map(path => [path, readFileSync(path, "utf8")]));
  const workflowManifest = JSON.parse(before.get(tracked[0]));
  const backendManifest = JSON.parse(readFileSync(resolve(backend, "package.json"), "utf8"));
  if (backendManifest.name !== "dsh-codex-kit-backend" || backendManifest.version !== workflowManifest.dependencies?.[backendManifest.name]) {
    throw new Error("Adjacent dsh-codex-kit-backend does not match the workflow dependency");
  }

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const exec = (args, cwd) => {
    const result = run(npm, args, { cwd, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm ${args.join(" ")} failed (${result.status ?? "signal"})`);
  };
  try {
    exec(["ci", "--ignore-scripts", "--no-audit", "--no-fund"], codex);
    exec(["install", "--ignore-scripts", "--no-save", "--no-audit", "--no-fund", backend], root);
    exec(["run", "build"], codex);
  } finally {
    for (const [path, contents] of before) {
      if (readFileSync(path, "utf8") !== contents) throw new Error(`Local preparation modified ${path}`);
    }
  }
  console.log("dsh-workflow-kit local dependencies ready");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) prepareLocal();
