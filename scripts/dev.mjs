import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const profile = option("--profile") ?? process.env.DSH_PROFILE ?? "workflow-dev";
const codex = resolve(option("--codex-kit") ?? process.env.DSH_CODEX_KIT_CHECKOUT ?? "../dsh-codex-kit");
const dshHome = resolve(process.env.DSH_HOME ?? join(homedir(), ".dsh"));
const profileManifest = join(dshHome, "profiles", profile, "package.json");

if (!existsSync(join(codex, "scripts", "watch.mjs"))) throw new Error(`Codex watch entry not found: ${codex}`);
if (!existsSync(profileManifest)) throw new Error(`DSH profile ${profile} is not prepared. Follow README.md once before npm run dev.`);
const kitBundles = ["dsh-codex-kit-backend", "dsh-codex-kit", "dsh-workflow-kit"];
const bundles = JSON.parse(readFileSync(profileManifest, "utf8"))?.dsh?.profile?.bundles;
if (bundles?.filter(bundle => kitBundles.includes(bundle)).join("\0") !== kitBundles.join("\0")) throw new Error(`DSH profile ${profile} must load backend, UI, then workflow exactly once.`);

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
start("dsh", ["--profile", profile, "--no-open", "--port", "0"]);
console.log(`dsh-workflow-kit dev processes started (profile ${profile}; Codex ${codex})`);
