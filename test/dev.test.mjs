import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const dev = fileURLToPath(new URL("../scripts/dev.mjs", import.meta.url));
const waitFor = async check => {
  for (let index = 0; index < 100; index++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for dev fixture");
};

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

const devFixture = t => {
  const root = mkdtempSync(join(tmpdir(), "workflow-dev-reuse-"));
  const bin = join(root, "bin"), home = join(root, "home"), cwd = join(root, "workflow"), codex = join(root, "codex");
  const profileDir = join(home, "profiles", "workflow-dev"), stateDir = join(profileDir, "state", "codex-kit");
  for (const path of [bin, join(profileDir, "node_modules"), stateDir, join(cwd, "scripts"), join(codex, "scripts")]) mkdirSync(path, { recursive: true });
  symlinkSync(fileURLToPath(new URL("../../dsh-codex-kit/packages/dsh-codex-kit-backend", import.meta.url)), join(profileDir, "node_modules", "dsh-codex-kit-backend"));
  symlinkSync(fileURLToPath(new URL("../../dsh-codex-kit/packages/dsh-codex-kit", import.meta.url)), join(profileDir, "node_modules", "dsh-codex-kit"));
  symlinkSync(fileURLToPath(new URL("../", import.meta.url)), join(profileDir, "node_modules", "dsh-workflow-kit"));
  writeFileSync(join(profileDir, "package.json"), JSON.stringify({ dsh: { profile: { bundles: ["dsh-codex-kit-backend", "dsh-codex-kit", "dsh-workflow-kit"] } } }));
  writeFileSync(join(profileDir, "cordis.patch.yml"), `- id: dsh-codex-kit-backend\n  config:\n    stateDir: ${stateDir}\n`);
  writeFileSync(join(bin, "npm"), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(bin, "dsh"), `#!/usr/bin/env node\nimport { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(join(root, "hosts"))}, String(process.pid) + "\\n");\nsetInterval(() => {}, 1000);\n`);
  chmodSync(join(bin, "npm"), 0o755); chmodSync(join(bin, "dsh"), 0o755);
  const watcher = name => `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(join(root, name))}, String(process.pid));\n${name === "codex-pid" ? 'console.log("dsh-codex-kit watch ready");' : ""}\nsetInterval(() => {}, 1000);\n`;
  writeFileSync(join(codex, "scripts", "watch.mjs"), watcher("codex-pid"));
  writeFileSync(join(cwd, "scripts", "watch.mjs"), watcher("workflow-pid"));

  const env = { ...process.env, DSH_HOME: home, PATH: `${bin}:${process.env.PATH}` };
  const children = [];
  t.after(async () => {
    await Promise.all(children.map(child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise(resolve => child.once("exit", resolve));
      child.kill("SIGINT");
      return exited;
    }));
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    stateDir,
    startHost(profile = "workflow-dev") {
      const child = spawn(join(bin, "dsh"), ["--profile", profile], { env, stdio: "ignore" });
      children.push(child);
      return child;
    },
    lock(pid) {
      mkdirSync(join(stateDir, "owner.lock"));
      writeFileSync(join(stateDir, "owner.lock", "pid"), String(pid));
    },
    startDev() {
      const child = spawn(process.execPath, [dev, "--codex-kit", codex], { cwd, env, stdio: "inherit" });
      children.push(child);
      return child;
    },
  };
};

const stopDev = async child => {
  child.kill("SIGINT");
  await waitFor(() => child.exitCode !== null || child.signalCode !== null);
};

test("joint dev reuses a live Host for the same profile and leaves it running", async t => {
  if (process.platform !== "linux") return t.skip("live process command lines use Linux /proc");
  const fixture = devFixture(t), host = fixture.startHost();
  await waitFor(() => existsSync(join(fixture.root, "hosts")));
  fixture.lock(host.pid);
  const run = fixture.startDev();

  await waitFor(() => existsSync(join(fixture.root, "workflow-pid")));
  assert.equal(readFileSync(join(fixture.root, "hosts"), "utf8").trim().split("\n").length, 1);
  const watcherPids = ["codex-pid", "workflow-pid"].map(name => Number(readFileSync(join(fixture.root, name), "utf8")));
  for (const pid of watcherPids) assert.equal(alive(pid), true);
  await stopDev(run);
  await waitFor(() => watcherPids.every(pid => !alive(pid)));
  assert.equal(alive(host.pid), true);
});

test("joint dev still starts and owns a Host when the profile has no owner lock", async t => {
  const fixture = devFixture(t), run = fixture.startDev();
  await waitFor(() => existsSync(join(fixture.root, "workflow-pid")) || run.exitCode !== null);
  assert.equal(run.exitCode, null);
  await waitFor(() => existsSync(join(fixture.root, "hosts")));
  const hostPid = Number(readFileSync(join(fixture.root, "hosts"), "utf8").trim());
  assert.equal(alive(hostPid), true);
  await stopDev(run);
  await waitFor(() => !alive(hostPid));
});

test("joint dev does not reuse a stale owner lock", async t => {
  const fixture = devFixture(t);
  fixture.lock(99_999_999);
  const run = fixture.startDev();
  await waitFor(() => existsSync(join(fixture.root, "hosts")));
  const hostPid = Number(readFileSync(join(fixture.root, "hosts"), "utf8").trim());
  assert.equal(alive(hostPid), true);
  await stopDev(run);
  await waitFor(() => !alive(hostPid));
});

test("joint dev fails loud on invalid owner metadata instead of starting a Host", async t => {
  const fixture = devFixture(t);
  fixture.lock("invalid");
  const run = fixture.startDev();
  await waitFor(() => run.exitCode !== null || run.signalCode !== null);
  assert.equal(run.exitCode, 1);
  assert.equal(existsSync(join(fixture.root, "hosts")), false);
});

test("joint dev does not reuse a live Host for another profile", async t => {
  if (process.platform !== "linux") return t.skip("live process command lines use Linux /proc");
  const fixture = devFixture(t), otherHost = fixture.startHost("other-profile");
  await waitFor(() => existsSync(join(fixture.root, "hosts")));
  fixture.lock(otherHost.pid);
  const run = fixture.startDev();
  await waitFor(() => readFileSync(join(fixture.root, "hosts"), "utf8").trim().split("\n").length === 2);
  await stopDev(run);
  assert.equal(alive(otherHost.pid), true);
});

test("joint dev builds Codex first and launches one PATH dsh host", () => {
  const source = readFileSync(new URL("../scripts/dev.mjs", import.meta.url), "utf8");
  const ready = source.indexOf("dsh-codex-kit watch ready");
  const workflowBuild = source.indexOf('spawnSync("npm", ["run", "build"]');
  const host = source.indexOf('start("dsh", hostArgs)');
  assert.ok(ready >= 0 && workflowBuild > ready && host > workflowBuild);
  assert.equal(source.match(/start\("dsh"/g)?.length, 1);
  assert.match(source, /if \(!value \|\| value\.startsWith\("--"\)\)/);
  assert.match(source, /const patch = resolve\(value\)/);
  assert.match(source, /statSync\(patch\)\.isFile\(\)/);
  assert.match(source, /patchArgs\.push\("--patch", patch\)/);
  assert.match(source, /const hostArgs = \["--profile", profile, \.\.\.patchArgs, "--no-open", "--port", "0"\]/);
});

test("joint dev rejects a patch without a value before starting children", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/dev.mjs", import.meta.url)), "--patch"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--patch requires a file path/);
});

test("PATH dsh parses patch before pass-through app arguments", () => {
  const patch = fileURLToPath(new URL("../cordis.patch.yml", import.meta.url));
  const result = spawnSync("dsh", ["--patch", patch, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--patch <path>/);
  assert.doesNotMatch(result.stderr, /unknown option/);
});

test("pack check installs all three tarballs without legacy peer bypass", () => {
  const source = readFileSync(new URL("../scripts/pack-check.mjs", import.meta.url), "utf8");
  for (const name of ["dsh-codex-kit-backend", "dsh-codex-kit", "dsh-workflow-kit"]) assert.match(source, new RegExp(`"${name}"`));
  assert.doesNotMatch(source, /legacy-peer-deps/);
});
