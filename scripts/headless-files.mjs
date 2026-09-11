import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const retired = /^(?:package\/)?lib\/(?:client|transcript|input-menu|stats|native-Toast|native-Tooltip|native-icons|native-stat-dialog|native-styles|transcript-styles|conversation|models|skills|rollout-usage)\./;

export function assertHeadlessFiles(files) {
  const stale = files.find(file => retired.test(typeof file === "string" ? file : file.path));
  if (stale) throw new Error(`Workflow tarball contains retired artifact: ${typeof stale === "string" ? stale : stale.path}`);
}

export function copyWorkflowSource(root, target) {
  mkdirSync(target, { recursive: true });
  for (const file of ["package.json", "package-lock.json", "tsconfig.json", "README.md", "cordis.patch.yml"]) cpSync(join(root, file), join(target, file));
  for (const directory of ["src", "scripts", "docs"]) cpSync(join(root, directory), join(target, directory), { recursive: true, filter: path => !path.split("/").includes("lib") });
}

export function assertCombinationDependencies(name, dependencies) {
  const names = Object.keys(dependencies);
  if (name === "workflow" && names.some(value => value === "dsh-codex-kit" || value === "react" || value === "react-dom" || value.startsWith("@deepseek-ai/dsh-client-"))) {
    throw new Error("B+W install explicitly includes a UI dependency");
  }
  if (name === "codex" && names.includes("dsh-workflow-kit")) throw new Error("B+C install explicitly includes Workflow");
}
