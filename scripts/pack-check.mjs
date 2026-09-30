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
// The copy is what `npm pack` sees, so it must carry every published resource:
// `locale` is read through `exports` after a `file:` install, and the provider's
// client face (and with it `tsconfig.client.json`) is gone.
for (const path of ["src", "scripts", "package.json", "tsconfig.json", "README.md", "cordis.patch.yml", "LICENSE", "locale"]) cpSync(join(provider, path), join(providerSource, path), { recursive: true });
symlinkSync(join(provider, "node_modules"), join(providerSource, "node_modules"), "dir");
execFileSync("npm", ["run", "build"], { cwd: providerSource, stdio: "inherit" });
copyWorkflowSource(root, workflowSource);
symlinkSync(join(root, "node_modules"), join(workflowSource, "node_modules"), "dir");
execFileSync("npm", ["run", "build"], { cwd: workflowSource, stdio: "inherit" });
const pack = cwd => JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temp], { cwd, encoding: "utf8" }))[0];
const providerPack = pack(providerSource), workflowPack = pack(workflowSource);
assertHeadlessFiles(workflowPack.files);
// The isolated profile installs the host generation of its own accord and lets
// the plugin's optional peers resolve from it, the way a real profile does; the
// sibling plugin resolves to the pack under test.
const generation = (() => {
  const versions = new Set(Object.entries(manifest(join(root, "package.json")).devDependencies)
    .filter(([name]) => name.startsWith("@deepseek-ai/dsh-"))
    .map(([, spec]) => spec));
  if (versions.size !== 1) throw new Error(`devDependencies must pin one dsh generation, got: ${[...versions].join(", ")}`);
  return [...versions][0];
})();
const overrides = { "dsh-codex-app-provider": `file:${join(temp, providerPack.filename)}` };
for (const name of ["provider", "workflow"]) {
  const directory = join(temp, name); mkdirSync(directory);
  // The host CLI supplies the generation; only the plugin packs under test carry
  // the same-package client face, so only they are checked for it below.
  const plugins = ["dsh-codex-app-provider", ...(name === "workflow" ? ["dsh-workflow-kit"] : [])];
  const dependencies = {
    "@deepseek-ai/dsh": generation,
    "dsh-codex-app-provider": overrides["dsh-codex-app-provider"],
    ...(name === "workflow" ? { "dsh-workflow-kit": `file:${join(temp, workflowPack.filename)}` } : {}),
  };
  assertCombinationDependencies(name, dependencies);
  writeFileSync(join(directory, "package.json"), JSON.stringify({ private: true, type: "module", dependencies, overrides }, null, 2));
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline", "--fetch-retries=0", ...(process.env.DSH_TEST_NPM_CACHE ? ["--cache", process.env.DSH_TEST_NPM_CACHE] : [])], { cwd: directory, stdio: "inherit" });
  const lock = manifest(join(directory, "package-lock.json"));
  if (Object.keys(lock.packages).some(path => /node_modules\/dsh-codex-kit(?:-backend)?$/.test(path))) throw new Error("Installed legacy kit dependency");
  // A plugin ships a same-package client bundle only when its manifest declares
  // one: the provider is Host-only since its client half was retired, while the
  // workflow kit drives the browser UI. Every declared face must be present, and
  // the workflow combination must declare at least one, so this cannot no-op.
  const withClient = plugins.filter(packageName => manifest(join(directory, "node_modules", packageName, "package.json")).dsh?.client !== undefined);
  if (name === "workflow" && withClient.length === 0) throw new Error("no pack in the workflow combination declares a client face");
  for (const packageName of withClient) {
    const entry = manifest(join(directory, "node_modules", packageName, "package.json"));
    if (!entry.exports["./client"]) throw new Error(`${packageName} has no same-package client`);
    if (!readFileSync(join(directory, "node_modules", packageName, "lib/client.js"), "utf8").includes("__ModuleLoader__")) throw new Error(`${packageName} client bundle missing`);
  }
  await verifyInstalledRuntime(directory, { workflow: name === "workflow" });
}
console.log("PASS_PROVIDER_AND_WORKFLOW_ISOLATED_PACKS (real Node/Cordis; no model or browser)");
