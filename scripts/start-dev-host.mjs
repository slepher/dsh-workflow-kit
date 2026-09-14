/**
 * Start (or just check) the dev Host for the linked profile, without the
 * long-lived build watchers `npm run dev` also owns.
 *
 * The profile's own `cordis.patch.yml` carries the module-HMR row for the two
 * business checkouts, so this script only verifies that binding and runs `dsh`.
 * Publish sources separately with `npm run publish` in either checkout
 * (`npm run publish:watch` to keep republishing): client-only changes are picked
 * up by the browser's client-hmr poll, host module changes reload through HMR.
 *
 * Usage: node scripts/start-dev-host.mjs [--profile name] [--port 3080] [--check]
 */
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeEntries, loadOptionalPatches, loadProfileDirectory, readProfileManifest, resolveProfileDir } from "@deepseek-ai/dsh-app-boot";

/** Workspace holding both business checkouts, one level above this repository. */
const WORKSPACE = fileURLToPath(new URL("../../", import.meta.url));
const checkouts = {
  "dsh-codex-app-provider": join(WORKSPACE, "dsh-codex-app-provider"),
  "dsh-workflow-kit": join(WORKSPACE, "dsh-workflow-kit"),
};
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const profile = option("--profile", "workflow-kit-dev");
const port = option("--port", "3080");
const dshHome = resolve(process.env.DSH_HOME ?? join(homedir(), ".dsh"));
const profileDir = resolveProfileDir(profile, dshHome);

// Same composition the launcher performs: bundle layers, the profile patch, then the home patch.
const manifest = readProfileManifest("dsh", profileDir);
const loaded = loadProfileDirectory("dsh", profileDir, join(profileDir, "package.json"));
const homePatches = loadOptionalPatches("dsh", join(dshHome, "cordis.patch.yml")) ?? [];
const entries = composeEntries([...loaded.layers.map(layer => layer.patches), loaded.patches, homePatches]);
const enabled = entries.filter(entry => entry.disabled !== true);

const expectedBundles = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-codex-app-provider", "dsh-workflow-kit"];
const bundles = manifest.dsh?.profile?.bundles ?? [];
if (bundles.join("|") !== expectedBundles.join("|")) {
  throw new Error(`profile ${profile} must load ${expectedBundles.join(", ")} in that order, got ${bundles.join(", ")}`);
}
for (const [name, checkout] of Object.entries(checkouts)) {
  const linked = join(profileDir, "node_modules", name);
  if (!existsSync(linked)) throw new Error(`${name} is not installed in profile ${profile}`);
  if (realpathSync(linked) !== realpathSync(checkout)) throw new Error(`${name} must resolve to ${checkout}, not ${realpathSync(linked)}; run the link setup first`);
  if (!existsSync(join(checkout, "lib", "index.js"))) throw new Error(`${name} has no built lib; run "npm run publish" in ${checkout}`);
  if (enabled.filter(entry => entry.id === name || entry.name === name).length !== 1) throw new Error(`profile ${profile} must enable exactly one ${name} consumer`);
}

const hmr = enabled.find(entry => entry.id === "hmr");
const base = hmr?.config?.base;
const roots = hmr?.config?.root;
if (typeof base !== "string" || !isAbsolute(base) || !Array.isArray(roots)) {
  throw new Error(`profile ${profile} must enable the hmr row with an absolute base and a root list`);
}
const resolved = roots.map(path => resolve(base, path));
const missing = Object.values(checkouts).map(checkout => resolve(checkout, "lib")).filter(path => !resolved.includes(path));
if (missing.length) throw new Error(`profile ${profile} HMR roots must cover ${missing.join(", ")}; got ${resolved.join(", ")}`);

console.log(`profile ${profile}: both packages link to their checkouts`);
console.log(`hmr roots: ${resolved.join(", ")}`);
if (process.argv.includes("--check")) {
  console.log("DEV_HOST_CHECK_OK");
  process.exit(0);
}

const args = ["--profile", profile, "--no-open", "--port", String(port)];
console.log(`dsh ${args.join(" ")}`);
const child = spawn("dsh", args, { cwd: WORKSPACE, stdio: "inherit" });
child.once("error", error => { console.error(`cannot start dsh: ${error.message}`); process.exitCode = 1; });
child.once("exit", code => { process.exitCode = code ?? 0; });
