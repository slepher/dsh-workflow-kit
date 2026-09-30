import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCombinationDependencies, assertHeadlessFiles, copyWorkflowSource } from "./headless-files.mjs";
import { verifyInstalledRuntime } from "./runtime-pack-check.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const provider = resolve(root, process.env.DSH_CODEX_APP_PROVIDER_CHECKOUT ?? "../dsh-codex-app-provider");
const temp = mkdtempSync(join(tmpdir(), "dsh-workflow-kit-pack-"));
const manifest = path => JSON.parse(readFileSync(path, "utf8"));
console.log(`Isolated pack evidence: ${temp}`);
const providerSource = join(temp, "provider-source"), workflowSource = join(temp, "workflow-source");
mkdirSync(providerSource);
for (const path of ["src", "scripts", "package.json", "tsconfig.json", "tsconfig.client.json", "README.md", "cordis.patch.yml", "LICENSE"]) cpSync(join(provider, path), join(providerSource, path), { recursive: true });
symlinkSync(join(provider, "node_modules"), join(providerSource, "node_modules"), "dir");
execFileSync("npm", ["run", "build"], { cwd: providerSource, stdio: "inherit" });
copyWorkflowSource(root, workflowSource);
symlinkSync(join(root, "node_modules"), join(workflowSource, "node_modules"), "dir");
execFileSync("npm", ["run", "build"], { cwd: workflowSource, stdio: "inherit" });
const pack = cwd => JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temp], { cwd, encoding: "utf8" }))[0];
const providerPack = pack(providerSource), workflowPack = pack(workflowSource);
assertHeadlessFiles(workflowPack.files);
// Nothing pins the dsh family here: the isolated profile installs the plugin
// tarballs and lets npm resolve the family from their own peer ranges, the way a
// real profile does. The sibling plugin resolves to the pack under test.
const overrides = { "dsh-codex-app-provider": `file:${join(temp, providerPack.filename)}` };
for (const name of ["provider", "workflow"]) {
  const directory = join(temp, name); mkdirSync(directory);
  const dependencies = { "dsh-codex-app-provider": overrides["dsh-codex-app-provider"], ...(name === "workflow" ? { "dsh-workflow-kit": `file:${join(temp, workflowPack.filename)}` } : {}) };
  assertCombinationDependencies(name, dependencies);
  writeFileSync(join(directory, "package.json"), JSON.stringify({ private: true, type: "module", dependencies, overrides }, null, 2));
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline", "--fetch-retries=0", ...(process.env.DSH_TEST_NPM_CACHE ? ["--cache", process.env.DSH_TEST_NPM_CACHE] : [])], { cwd: directory, stdio: "inherit" });
  const lock = manifest(join(directory, "package-lock.json"));
  if (Object.keys(lock.packages).some(path => /node_modules\/dsh-codex-kit(?:-backend)?$/.test(path))) throw new Error("Installed legacy kit dependency");
  for (const packageName of Object.keys(dependencies)) {
    const entry = manifest(join(directory, "node_modules", packageName, "package.json"));
    if (!entry.exports["./client"]) throw new Error(`${packageName} has no same-package client`);
    if (!readFileSync(join(directory, "node_modules", packageName, "lib/client.js"), "utf8").includes("__ModuleLoader__")) throw new Error(`${packageName} client bundle missing`);
  }
  await verifyInstalledRuntime(directory, { workflow: name === "workflow" });
}
console.log("PASS_PROVIDER_AND_WORKFLOW_ISOLATED_PACKS (real Node/Cordis; no model or browser)");
