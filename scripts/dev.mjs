import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url)), args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const codex = resolve(option("--app-provider") ?? process.env.DSH_CODEX_APP_PROVIDER_CHECKOUT ?? "../dsh-codex-app-provider");
if (!existsSync(join(codex, "src/provider.ts")) || !existsSync(join(codex, "scripts/watch.mjs"))) throw new Error(`Codex dev entries not found: ${codex}`);
const host = await import("./dev-host.mjs");
const { profile, patches, dshHome } = host.parseDevOptions(args);
const profileManifest = join(dshHome, "profiles", profile, "package.json");
if (!existsSync(profileManifest)) throw new Error(`DSH profile ${profile} is not prepared. Follow README.md once before npm run dev.`);
const expectedBundles = ["dsh-codex-app-provider", "dsh-workflow-kit"];
const bundles = JSON.parse(readFileSync(profileManifest, "utf8"))?.dsh?.profile?.bundles;
if (bundles?.filter(bundle => expectedBundles.includes(bundle)).join("\0") !== expectedBundles.join("\0")) throw new Error(`DSH profile ${profile} must load app provider, then workflow exactly once.`);

// Both checkouts publish into their own `lib`; the profile and this overlay must agree on exactly these roots.
const expectedRoots = [join(root, "lib"), join(codex, "lib")];
const effective = host.resolveDevHost({ profile, patches, dshHome, expectedRoots, providerCheckout: codex });
let owner = host.inspectOwner(effective.stateDir, profile);
const temp = mkdtempSync(join(tmpdir(), "dsh-workflow-kit-dev-")), overlay = join(temp, "hmr.patch.yml");
const base = dirname(codex);
writeFileSync(overlay, `- id: hmr\n  disabled: false\n  config:\n    base: ${JSON.stringify(base)}\n    root:\n${expectedRoots.map(path => `      - ${JSON.stringify(relative(base, path))}`).join("\n")}\n    ignored:\n      - "**/node_modules"\n      - "**/.*"\n    debounce: 100\n`);

const children = new Set(); let closing = false;
const stopped = Symbol("stopped");
const barrier = () => { if (closing) throw stopped; };
const start = (command, argv, options = {}, persistent = true) => {
  barrier();
  const child = spawn(command, argv, { stdio: ["inherit", "pipe", "inherit"], shell: process.platform === "win32", ...options });
  children.add(child); child.stdout?.pipe(process.stdout);
  child.once("error", error => { if (!closing) { console.error(String(error)); void close(1); } });
  child.once("exit", (code, signal) => { children.delete(child); if (persistent && !closing) void close(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? 1); });
  return child;
};
const waitExit = child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve(child.exitCode ?? 1) : new Promise(resolveExit => child.once("exit", code => resolveExit(code ?? 1)));
const close = async code => {
  if (closing) return; closing = true;
  for (const child of children) child.kill("SIGINT");
  await Promise.all([...children].map(waitExit)); rmSync(temp, { recursive: true, force: true }); process.exit(code);
};
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void close(0));
process.once("exit", () => rmSync(temp, { recursive: true, force: true }));
const ready = (child, marker) => new Promise((resolveReady, reject) => {
  let buffered = "";
  child.stdout.on("data", chunk => { buffered += chunk; if (buffered.includes(marker)) resolveReady(); });
  child.once("exit", code => reject(new Error(`${marker} process exited before ready (${code ?? "signal"})`)));
});
const build = async cwd => {
  const child = start("npm", ["run", "build"], { cwd }, false), code = await waitExit(child);
  barrier();
  if (code !== 0) throw new Error(`Initial build failed in ${cwd} (${code})`);
};

try {
  const assertHmr = value => {
    if (value.missingRoots.length || value.extraRoots.length || value.duplicateRoots.length) throw new Error(`Invalid HMR roots; missing: ${value.missingRoots.join(", ") || "none"}; extra: ${value.extraRoots.join(", ") || "none"}; duplicate: ${value.duplicateRoots.join(", ") || "none"}`);
  };
  if (owner !== undefined) {
    assertHmr(effective);
    host.assertBaseline(codex, ["lib/index.js", "lib/backend.js", "lib/provider.js", "lib/client.js"]);
    host.assertBaseline(root, ["lib/index.js", "lib/host.js", "lib/workers.js", "lib/workflow.js", "lib/generated/prompts.js"]);
  } else {
    const launched = host.resolveDevHost({ profile, patches: [...patches, overlay], dshHome, expectedRoots, providerCheckout: codex });
    assertHmr(launched);
    if (launched.stateDir !== effective.stateDir) throw new Error("HMR overlay changed backend stateDir");
    await build(codex); barrier(); await build(root); barrier();
  }
  const codexWatch = start(process.execPath, ["scripts/watch.mjs", "--no-initial-build"], { cwd: codex });
  await ready(codexWatch, "dsh-codex-app-provider watch ready"); barrier();
  const workflowWatch = start(process.execPath, ["scripts/watch.mjs", "--no-initial-build", "--app-provider", codex], { cwd: root });
  await ready(workflowWatch, "dsh-workflow-kit watch ready"); barrier();
  if (owner === undefined) {
    barrier();
    owner = host.inspectOwner(effective.stateDir, profile);
    barrier();
    if (owner !== undefined) assertHmr(effective);
    if (owner === undefined) start("dsh", ["--profile", profile, ...patches.flatMap(path => ["--patch", path]), "--patch", overlay, "--no-open", "--port", "0"], { cwd: root });
  }
  if (owner === undefined) console.log(`dsh-workflow-kit dev processes started (profile ${profile}; Codex ${codex}; port 0)`);
  else console.log(`Reusing dsh Host pid ${owner} for profile ${profile} (${effective.stateDir})`);
} catch (error) {
  if (error === stopped) { /* cleanup already owns exit */ }
  else {
  console.error(error instanceof Error ? error.message : String(error));
  await close(1);
  }
}
