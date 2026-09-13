// Migrated from dsh-codex-kit/scripts/dev-host.mjs; owner identity and overlay semantics retained.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { composeEntries, loadOptionalPatches, loadOverlayPatches, loadProfileDirectory, resolveProfileDir } from "@deepseek-ai/dsh-app-boot";

export function parseDevOptions(args, env = process.env) {
  const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const profile = option("--profile") ?? env.DSH_PROFILE ?? "workflow-dev";
  const patches = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== "--patch") continue;
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error("--patch requires a file path");
    const path = resolve(value);
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`DSH patch file not found: ${path}`);
    patches.push(path);
  }
  return { profile, patches, dshHome: resolve(env.DSH_HOME ?? join(homedir(), ".dsh")) };
}

export function resolveDevHost({ profile, patches, dshHome, expectedRoots, providerCheckout }) {
  if (process.platform !== "linux") throw new Error("Dev Host owner identity requires Linux /proc");
  const directory = resolveProfileDir(profile, dshHome);
  const loaded = loadProfileDirectory("dsh", directory, join(directory, "package.json"));
  const homePatches = loadOptionalPatches("dsh", join(dshHome, "cordis.patch.yml")) ?? [];
  const overlays = patches.map(path => loadOverlayPatches("dsh", path));
  const entries = composeEntries([...loaded.layers.map(layer => layer.patches), loaded.patches, homePatches, ...overlays]);
  const enabled = entries.filter(entry => entry.disabled !== true);
  const requireConsumer = (id, name) => {
    const matches = enabled.filter(entry => entry.id === id || entry.name === name);
    if (matches.length !== 1 || matches[0].id !== id || matches[0].name !== name) throw new Error(`DSH profile ${profile} must enable exactly one ${id} consumer with name ${name}.`);
  };
  requireConsumer("dsh-codex-app-provider", "dsh-codex-app-provider");
  if (enabled.some(entry => String(entry.name ?? "").startsWith("dsh-codex-kit") || entry.id === "codex-workers-service" || String(entry.name ?? "").startsWith("dsh-subagents-codex"))) throw new Error(`DSH profile ${profile} enables a retired Codex consumer.`);
  const workflowEntries = enabled.filter(entry => entry.id === "dsh-workflow-kit" || entry.name === "dsh-workflow-kit");
  if (workflowEntries.length > 1 || workflowEntries[0] && (workflowEntries[0].id !== "dsh-workflow-kit" || workflowEntries[0].name !== "dsh-workflow-kit")) throw new Error(`DSH profile ${profile} must enable at most one dsh-workflow-kit consumer.`);
  const backend = entries.find(entry => entry.id === "dsh-codex-app-provider" && entry.disabled !== true);
  const stateDir = backend?.config?.stateDir;
  if (typeof stateDir !== "string" || !isAbsolute(stateDir)) throw new Error(`DSH profile ${profile} must configure an absolute backend stateDir.`);
  const hmr = entries.find(entry => entry.id === "hmr" && entry.disabled !== true), base = hmr?.config?.base, roots = hmr?.config?.root;
  if (typeof base !== "string" || !isAbsolute(base) || !Array.isArray(roots)) throw new Error(`DSH profile ${profile} must configure enabled HMR roots.`);
  const providerLayer = loaded.layers.find(layer => layer.packageName === "dsh-codex-app-provider");
  if (!providerLayer || realpathSync(providerLayer.packageDir) !== realpathSync(providerCheckout)) throw new Error(`DSH profile ${profile} must resolve dsh-codex-app-provider to the requested checkout.`);
  const workflowLayer = workflowEntries.length ? loaded.layers.find(layer => layer.packageName === "dsh-workflow-kit") : undefined;
  if (workflowEntries.length && !workflowLayer) throw new Error(`DSH profile ${profile} cannot resolve the enabled Workflow consumer.`);
  const requiredRoots = [...new Set([...expectedRoots.map(path => resolve(path)), ...(workflowLayer ? [resolve(realpathSync(workflowLayer.packageDir), "lib")] : [])])];
  const actual = roots.map(path => resolve(base, path));
  const duplicateRoots = actual.filter((path, index) => actual.indexOf(path) !== index);
  const missingRoots = requiredRoots.filter(path => !actual.includes(path));
  const extraRoots = actual.filter(path => !requiredRoots.includes(path));
  return { stateDir, entries, requiredRoots, missingRoots, extraRoots, duplicateRoots, joint: workflowEntries.length === 1 };
}

export function inspectOwner(stateDir, profile) {
  const pidFile = join(stateDir, "owner.lock", "pid");
  let text;
  try { text = readFileSync(pidFile, "utf8"); }
  catch (error) { if (error?.code === "ENOENT") return; throw error; }
  const pid = Number(text);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid backend owner PID in ${pidFile}`);
  try { process.kill(pid, 0); }
  catch (error) { if (error?.code === "ESRCH") return; throw new Error(`Cannot inspect backend owner pid ${pid}`, { cause: error }); }
  let argv;
  try { argv = readFileSync(`/proc/${pid}/cmdline`).toString().split("\0").filter(Boolean); }
  catch (error) {
    if (error?.code === "ENOENT") {
      try { process.kill(pid, 0); } catch (probe) { if (probe?.code === "ESRCH") return; }
    }
    throw new Error(`Cannot read backend owner pid ${pid} command line`, { cause: error });
  }
  const profileIndex = argv.indexOf("--profile");
  const official = argv.some(argument => argument.split(/[\\/]/).at(-1) === "dsh" || /[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js$/.test(argument));
  if (!official || profileIndex < 0 || argv[profileIndex + 1] !== profile) throw new Error(`Backend owner pid ${pid} is not the official dsh Host for profile ${profile}`);
  return pid;
}

export function assertBaseline(root, paths) {
  const missing = paths.filter(path => !existsSync(join(root, path)));
  if (missing.length) throw new Error(`Dev Host reuse requires baseline artifacts: ${missing.join(", ")}`);
}
