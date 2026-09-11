import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { assertCombinationDependencies, assertHeadlessFiles, copyWorkflowSource } from "./headless-files.mjs";
import { verifyInstalledRuntime } from "./runtime-pack-check.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const codex = resolve(root, process.env.DSH_CODEX_KIT_CHECKOUT ?? "../dsh-codex-kit");
const temp = mkdtempSync(join(tmpdir(), "dsh-workflow-kit-pack-"));
const installedDshPackage = /(?:^|\/)node_modules\/@deepseek-ai\/dsh-[^/]+$/;

try {
  const codexSource = join(temp, "codex-source"), workflowSource = join(temp, "workflow-source");
  const helpers = await import(pathToFileURL(join(codex, "scripts/pack-check.mjs")));
  helpers.copyPackSource(codex, codexSource);
  symlinkSync(join(codex, "node_modules"), join(codexSource, "node_modules"), "dir");
  execFileSync("npm", ["run", "build", "-w", "dsh-codex-kit-backend"], { cwd: codexSource, stdio: "inherit" });
  execFileSync("npm", ["run", "build", "-w", "dsh-codex-kit"], { cwd: codexSource, stdio: "inherit" });
  copyWorkflowSource(root, workflowSource);
  mkdirSync(join(workflowSource, "node_modules"));
  for (const name of readdirSync(join(root, "node_modules"))) {
    if (name === "dsh-codex-kit-backend") continue;
    symlinkSync(join(root, "node_modules", name), join(workflowSource, "node_modules", name));
  }
  cpSync(join(codexSource, "packages/dsh-codex-kit-backend"), join(workflowSource, "node_modules/dsh-codex-kit-backend"), { recursive: true });
  execFileSync("npm", ["run", "build"], { cwd: workflowSource, stdio: "inherit" });
  const pack = (cwd, workspace) => JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", temp, ...(workspace ? ["-w", workspace] : [])], { cwd, encoding: "utf8" }))[0];
  const backendPack = pack(codexSource, "dsh-codex-kit-backend"), uiPack = pack(codexSource, "dsh-codex-kit"), workflowPack = pack(workflowSource);
  const backend = join(temp, backendPack.filename), ui = join(temp, uiPack.filename), workflow = join(temp, workflowPack.filename);
  assertHeadlessFiles(workflowPack.files);
  const sourceLocks = [join(codexSource, "package-lock.json"), join(workflowSource, "package-lock.json")]
    .map(path => JSON.parse(readFileSync(path, "utf8")));
  const lockedVersion = name => {
    const values = sourceLocks.flatMap(lock => Object.entries(lock.packages)
      .filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`))
      .map(([, value]) => value.version).filter(Boolean));
    const value = values.includes("0.1.5-rc.1") ? "0.1.5-rc.1" : values[0];
    if (!value) throw new Error(`No offline locked version for ${name}`);
    return value;
  };
  const manifest = path => JSON.parse(readFileSync(path, "utf8"));
  const backendManifest = manifest(join(codexSource, "packages/dsh-codex-kit-backend/package.json"));
  const clientManifest = manifest(join(codexSource, "packages/dsh-codex-kit/package.json"));
  const workflowManifest = manifest(join(workflowSource, "package.json"));
  const pins = names => Object.fromEntries([...new Set(names)].map(name => [name, lockedVersion(name)]));
  const backendPeers = Object.keys(backendManifest.peerDependencies ?? {});
  const clientPeers = Object.keys(clientManifest.peerDependencies ?? {});
  const workflowRuntime = [...Object.keys(workflowManifest.dependencies ?? {}), ...Object.keys(workflowManifest.peerDependencies ?? {})]
    .filter(name => name !== "dsh-codex-kit-backend");
  const install = async (name, packages) => {
    const directory = join(temp, name); mkdirSync(directory);
    assertCombinationDependencies(name, packages);
    writeFileSync(join(directory, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: packages }));
    execFileSync("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: directory, stdio: "inherit" });
    const installedLock = JSON.parse(readFileSync(join(directory, "package-lock.json"), "utf8"));
    for (const [path, value] of Object.entries(installedLock.packages)) if (installedDshPackage.test(path) && value.version !== "0.1.5-rc.1") throw new Error(`${path} resolved ${value.version}`);
    const backendEntry = await import(pathToFileURL(join(directory, "node_modules/dsh-codex-kit-backend/lib/index.js")));
    if (typeof backendEntry.CodexSessionBackend !== "function") throw new Error(`${name} did not load the B backend`);
    if (packages["dsh-codex-kit"]) {
      const codexEntry = await import(pathToFileURL(join(directory, "node_modules/dsh-codex-kit/lib/index.js")));
      if (typeof codexEntry.apply !== "function") throw new Error(`${name} did not load C`);
    }
    if (packages["dsh-workflow-kit"]) {
      const workflowEntry = await import(pathToFileURL(join(directory, "node_modules/dsh-workflow-kit/lib/index.js")));
      if (typeof workflowEntry.apply !== "function") throw new Error(`${name} did not load W`);
      const require = createRequire(join(directory, "check.cjs"));
      try { require.resolve("dsh-workflow-kit/client"); throw new Error("W ./client unexpectedly resolved"); }
      catch (error) { if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error; }
    }
    if (packages["dsh-codex-kit"]) {
      const bundle = readFileSync(join(directory, "node_modules/dsh-codex-kit/lib/client.js"), "utf8");
      helpers.validateClientBundle(bundle); helpers.applyClientBundle(bundle, directory);
    }
    await verifyInstalledRuntime(directory, { client: Boolean(packages["dsh-codex-kit"]), workflow: Boolean(packages["dsh-workflow-kit"]) });
    rmSync(directory, { recursive: true, force: true });
  };
  await install("codex", { ...pins([...backendPeers, ...clientPeers]), "dsh-codex-kit-backend": `file:${backend}`, "dsh-codex-kit": `file:${ui}` });
  await install("workflow", { ...pins([...backendPeers, ...workflowRuntime]), "dsh-codex-kit-backend": `file:${backend}`, "dsh-workflow-kit": `file:${workflow}` });
  await install("joint", { ...pins([...backendPeers, ...clientPeers, ...workflowRuntime]), "dsh-codex-kit-backend": `file:${backend}`, "dsh-codex-kit": `file:${ui}`, "dsh-workflow-kit": `file:${workflow}` });
  console.log("dsh workflow C+B, B+W, and B+C+W installs ok");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
