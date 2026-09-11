import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { composeEntries, loadOptionalPatches, loadOverlayPatches, loadProfile } from "@deepseek-ai/dsh-app-boot";

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const profile = option("--profile") ?? process.env.DSH_PROFILE ?? "workflow-dev";
const codex = resolve(option("--codex-kit") ?? process.env.DSH_CODEX_KIT_CHECKOUT ?? "../dsh-codex-kit");
const patchArgs = [];
for (let index = 0; index < args.length; index++) {
  if (args[index] !== "--patch") continue;
  const value = args[++index];
  if (!value || value.startsWith("--")) throw new Error("--patch requires a file path");
  const patch = resolve(value);
  if (!existsSync(patch) || !statSync(patch).isFile()) throw new Error(`DSH patch file not found: ${patch}`);
  patchArgs.push("--patch", patch);
}
const dshHome = resolve(process.env.DSH_HOME ?? join(homedir(), ".dsh"));
const profileManifest = join(dshHome, "profiles", profile, "package.json");

if (!existsSync(join(codex, "scripts", "watch.mjs"))) throw new Error(`Codex watch entry not found: ${codex}`);
if (!existsSync(profileManifest)) throw new Error(`DSH profile ${profile} is not prepared. Follow README.md once before npm run dev.`);
const kitBundles = ["dsh-codex-kit-backend", "dsh-codex-kit", "dsh-workflow-kit"];
const bundles = JSON.parse(readFileSync(profileManifest, "utf8"))?.dsh?.profile?.bundles;
if (bundles?.filter(bundle => kitBundles.includes(bundle)).join("\0") !== kitBundles.join("\0")) throw new Error(`DSH profile ${profile} must load backend, UI, then workflow exactly once.`);

const externalHost = () => {
  if (process.platform !== "linux") return;
  const installAnchor = createRequire(import.meta.url).resolve("@deepseek-ai/dsh/package.json");
  const loaded = loadProfile("dsh", profile, installAnchor, dshHome);
  const homePatches = loadOptionalPatches("dsh", join(dshHome, "cordis.patch.yml")) ?? [];
  const overlays = patchArgs.filter(argument => argument !== "--patch").map(path => loadOverlayPatches("dsh", path));
  const entries = composeEntries([...loaded.layers.map(layer => layer.patches), loaded.patches, homePatches, ...overlays]);
  const backend = entries.find(entry => entry.id === "dsh-codex-kit-backend");
  const stateDir = backend?.config?.stateDir;
  if (typeof stateDir !== "string" || !isAbsolute(stateDir)) throw new Error(`DSH profile ${profile} must configure an absolute backend stateDir.`);
  const pidFile = join(stateDir, "owner.lock", "pid");
  let text;
  try {
    text = readFileSync(pidFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const pid = Number(text);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid backend owner PID in ${pidFile}`);
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error?.code === "ESRCH") return;
    throw new Error(`Cannot inspect backend owner pid ${pid}`, { cause: error });
  }
  let argv;
  try {
    argv = readFileSync(`/proc/${pid}/cmdline`).toString().split("\0").filter(Boolean);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw new Error(`Cannot read backend owner pid ${pid} command line`, { cause: error });
  }
  const profileIndex = argv.indexOf("--profile");
  if (profileIndex < 0 || argv[profileIndex + 1] !== profile) return;
  if (!argv.some(argument => argument.split(/[\\/]/).at(-1) === "dsh" || /[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js$/.test(argument))) return;
  return pid;
};

const children = new Set(); let closing = false;
const start = (command, argv, options = {}) => {
  const child = spawn(command, argv, { stdio: ["inherit", "pipe", "inherit"], shell: process.platform === "win32", ...options });
  children.add(child); child.stdout?.pipe(process.stdout);
  child.once("exit", code => { children.delete(child); if (!closing) void close(code ?? 1); });
  return child;
};
const close = async code => {
  if (closing) return; closing = true;
  for (const child of children) child.kill("SIGINT");
  await Promise.all([...children].map(child => new Promise(resolveExit => child.once("exit", resolveExit))));
  process.exit(code);
};
process.once("SIGINT", () => void close(0)); process.once("SIGTERM", () => void close(0));

const codexWatch = start(process.execPath, ["scripts/watch.mjs"], { cwd: codex });
let buffered = "";
await new Promise((ready, reject) => {
  codexWatch.stdout.on("data", chunk => { buffered += chunk; if (buffered.includes("dsh-codex-kit watch ready")) ready(); });
  codexWatch.once("exit", code => reject(new Error(`Codex watcher exited before ready (${code ?? "signal"})`)));
});

const build = spawnSync("npm", ["run", "build"], { stdio: "inherit", shell: process.platform === "win32" });
if ((build.status ?? 1) !== 0) await close(build.status ?? 1);
start(process.execPath, ["scripts/watch.mjs"]);
const hostArgs = ["--profile", profile, ...patchArgs, "--no-open", "--port", "0"];
let hostPid;
try { hostPid = externalHost(); }
catch (error) { console.error(error); await close(1); }
if (hostPid === undefined) start("dsh", hostArgs);
else console.log(`Reusing dsh Host pid ${hostPid} for profile ${profile}`);
console.log(`dsh-workflow-kit dev processes started (profile ${profile}; Codex ${codex})`);
