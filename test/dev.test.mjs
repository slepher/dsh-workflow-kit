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
  for (const path of [bin, join(profileDir, "node_modules"), stateDir, join(cwd, "scripts"), join(codex, "scripts"), join(codex, "packages/dsh-codex-kit-backend/lib/host"), join(codex, "packages/dsh-codex-kit/lib"), join(cwd, "lib/generated")]) mkdirSync(path, { recursive: true });
  symlinkSync(fileURLToPath(new URL("../../dsh-codex-kit/packages/dsh-codex-kit-backend", import.meta.url)), join(profileDir, "node_modules", "dsh-codex-kit-backend"));
  symlinkSync(fileURLToPath(new URL("../../dsh-codex-kit/packages/dsh-codex-kit", import.meta.url)), join(profileDir, "node_modules", "dsh-codex-kit"));
  writeFileSync(join(cwd, "package.json"), readFileSync(new URL("../package.json", import.meta.url)));
  writeFileSync(join(cwd, "cordis.patch.yml"), readFileSync(new URL("../cordis.patch.yml", import.meta.url)));
  symlinkSync(cwd, join(profileDir, "node_modules", "dsh-workflow-kit"));
  writeFileSync(join(profileDir, "package.json"), JSON.stringify({ dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "dsh-codex-kit-backend", "dsh-codex-kit", "dsh-workflow-kit"] } } }));
  writeFileSync(join(profileDir, "cordis.patch.yml"), `- id: dsh-codex-kit-backend\n  config:\n    stateDir: ${stateDir}\n- id: hmr\n  disabled: false\n  config:\n    base: ${root}\n    root:\n      - codex/packages/dsh-codex-kit-backend/lib/host\n      - codex/packages/dsh-codex-kit/lib\n      - workflow/lib\n`);
  writeFileSync(join(bin, "npm"), `#!/bin/sh\necho "$PWD $*" >> ${join(root, "builds")}\ncount=$(wc -l < ${join(root, "builds")})\nif [ -f ${join(root,"block-second")} ] && [ "$count" = 2 ]; then touch ${join(root,"second-build-started")}; trap 'echo done > ${join(root,"second-build-done")}; exit 0' INT; while true; do sleep 1; done; fi\nexit 0\n`);
  writeFileSync(join(bin, "dsh"), `#!/usr/bin/env node\nimport { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(join(root, "hosts"))}, String(process.pid) + "\\n"); appendFileSync(${JSON.stringify(join(root, "host-argv"))}, JSON.stringify(process.argv.slice(2)) + "\\n");\nsetInterval(() => {}, 1000);\n`);
  chmodSync(join(bin, "npm"), 0o755); chmodSync(join(bin, "dsh"), 0o755);
  const watcher = (name, marker) => `import { appendFileSync, existsSync, writeFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(join(root, name))}, String(process.pid) + " " + process.argv.slice(2).join(" "));\nif (existsSync(${JSON.stringify(join(root, `fail-${name}`))})) process.exit(2); else if (existsSync(${JSON.stringify(join(root, `gate-${name}`))})) { const timer=setInterval(()=>{if(existsSync(${JSON.stringify(join(root, `release-${name}`))})){clearInterval(timer);console.log(${JSON.stringify(marker)});}},10); } else if (existsSync(${JSON.stringify(join(root, `late-${name}`))})) process.on("SIGINT", () => { console.log(${JSON.stringify(marker)}); writeFileSync(${JSON.stringify(join(root, `${name}-done`))}, "done"); setTimeout(() => process.exit(0), 40); }); else console.log(${JSON.stringify(marker)});\nsetInterval(() => {}, 1000);\n`;
  writeFileSync(join(codex, "scripts", "watch.mjs"), watcher("codex-pid", "dsh-codex-kit watch ready"));
  writeFileSync(join(cwd, "scripts", "watch.mjs"), watcher("workflow-pid", "dsh-workflow-kit watch ready"));
  writeFileSync(join(cwd, "scripts", "dev.mjs"), readFileSync(dev));
  writeFileSync(join(codex, "scripts", "dev-host.mjs"), readFileSync(fileURLToPath(new URL("../../dsh-codex-kit/scripts/dev-host.mjs", import.meta.url))));
  symlinkSync(fileURLToPath(new URL("../../dsh-codex-kit/node_modules", import.meta.url)), join(codex, "node_modules"));
  for (const path of ["packages/dsh-codex-kit-backend/lib/index.js", "packages/dsh-codex-kit-backend/lib/host/index.js", "packages/dsh-codex-kit/lib/index.js", "packages/dsh-codex-kit/lib/client.js"]) writeFileSync(join(codex, path), "baseline");
  for (const path of ["lib/index.js", "lib/host.js", "lib/workers.js", "lib/workflow.js", "lib/generated/prompts.js"]) writeFileSync(join(cwd, path), "baseline");

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
    startDev(extra = []) {
      const child = spawn(process.execPath, [join(cwd, "scripts/dev.mjs"), "--codex-kit", codex, ...extra], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
      child.output = ""; child.stdout.on("data", chunk => { child.output += chunk; }); child.stderr.on("data", chunk => { child.output += chunk; });
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

  await waitFor(() => existsSync(join(fixture.root, "workflow-pid")) || run.exitCode !== null);
  assert.equal(run.exitCode, null, run.output);
  assert.equal(existsSync(join(fixture.root, "builds")), false, "reuse performs no initial build");
  assert.match(readFileSync(join(fixture.root, "codex-pid"), "utf8"), /--no-initial-build/);
  assert.match(readFileSync(join(fixture.root, "workflow-pid"), "utf8"), /--no-initial-build --codex-kit/);
  assert.equal(readFileSync(join(fixture.root, "hosts"), "utf8").trim().split("\n").length, 1);
  const watcherPids = ["codex-pid", "workflow-pid"].map(name => Number(readFileSync(join(fixture.root, name), "utf8").split(" ")[0]));
  for (const pid of watcherPids) assert.equal(alive(pid), true);
  await stopDev(run);
  await waitFor(() => watcherPids.every(pid => !alive(pid)));
  assert.equal(alive(host.pid), true);
});

test("joint dev still starts and owns a Host when the profile has no owner lock", async t => {
  const fixture = devFixture(t), run = fixture.startDev();
  await waitFor(() => existsSync(join(fixture.root, "workflow-pid")) || run.exitCode !== null);
  assert.equal(run.exitCode, null, run.output);
  await waitFor(() => existsSync(join(fixture.root, "hosts")) || run.exitCode !== null);
  assert.equal(run.exitCode, null, run.output);
  assert.equal(readFileSync(join(fixture.root, "builds"), "utf8").trim().split("\n").length, 2, "Codex then W build once");
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

test("joint dev rejects a live owner for another profile without starting another Host", async t => {
  if (process.platform !== "linux") return t.skip("live process command lines use Linux /proc");
  const fixture = devFixture(t), otherHost = fixture.startHost("other-profile");
  await waitFor(() => existsSync(join(fixture.root, "hosts")));
  fixture.lock(otherHost.pid);
  const run = fixture.startDev();
  await waitFor(() => run.exitCode !== null || run.signalCode !== null);
  assert.equal(run.exitCode, 1, run.output);
  assert.equal(readFileSync(join(fixture.root, "hosts"), "utf8").trim().split("\n").length, 1);
  assert.equal(alive(otherHost.pid), true);
});

test("joint dev uses the shared owner helper and no nested Codex dev", () => {
  const source = readFileSync(new URL("../scripts/dev.mjs", import.meta.url), "utf8");
  assert.match(source, /scripts\/dev-host\.mjs/);
  assert.doesNotMatch(source, /scripts\/dev\.mjs.*cwd: codex/);
  assert.equal(source.match(/start\("dsh"/g)?.length, 1);
  assert.match(source, /"--no-initial-build"/);
  assert.match(source, /"--port", "0"/);
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

test("SIGINT after the cooperative second initial build cannot start either watcher or Host", async t => {
  const fixture = devFixture(t); writeFileSync(join(fixture.root, "block-second"), ""); const run = fixture.startDev();
  await waitFor(() => existsSync(join(fixture.root, "second-build-started"))); run.kill("SIGINT"); await waitFor(() => existsSync(join(fixture.root, "second-build-done"))); await waitFor(() => run.exitCode !== null || run.signalCode !== null);
  assert.equal(existsSync(join(fixture.root, "codex-pid")), false); assert.equal(existsSync(join(fixture.root, "workflow-pid")), false); assert.equal(existsSync(join(fixture.root, "hosts")), false);
});

test("late Codex ready during joint shutdown cannot start the W watcher or another Host", async t => {
  if (process.platform !== "linux") return t.skip("live process command lines use Linux /proc");
  const fixture = devFixture(t), host = fixture.startHost(); await waitFor(() => existsSync(join(fixture.root, "hosts"))); fixture.lock(host.pid); writeFileSync(join(fixture.root, "late-codex-pid"), ""); const run = fixture.startDev();
  await waitFor(() => existsSync(join(fixture.root, "codex-pid"))); run.kill("SIGINT"); await waitFor(() => existsSync(join(fixture.root, "codex-pid-done"))); await waitFor(() => run.exitCode !== null || run.signalCode !== null);
  assert.equal(existsSync(join(fixture.root, "workflow-pid")), false); assert.equal(readFileSync(join(fixture.root, "hosts"), "utf8").trim(), String(host.pid)); assert.equal(alive(host.pid), true);
});

test("ordered overlays select the final stateDir owner", async t => {
  if (process.platform !== "linux") return t.skip("live process command lines use Linux /proc");
  const fixture=devFixture(t), first=join(fixture.root,"first-state"), second=join(fixture.root,"second-state"), p1=join(fixture.root,"one.yml"), p2=join(fixture.root,"two.yml"); for(const path of [first,second]) mkdirSync(path); writeFileSync(p1,`- id: dsh-codex-kit-backend\n  config:\n    stateDir: ${first}\n`); writeFileSync(p2,`- id: dsh-codex-kit-backend\n  config:\n    stateDir: ${second}\n`); const owner=fixture.startHost(); await waitFor(()=>existsSync(join(fixture.root,"hosts"))); mkdirSync(join(second,"owner.lock")); writeFileSync(join(second,"owner.lock/pid"),String(owner.pid)); const run=fixture.startDev(["--patch",p1,"--patch",p2]); await waitFor(()=>existsSync(join(fixture.root,"workflow-pid"))||run.exitCode!==null); assert.equal(run.exitCode,null,run.output); assert.match(run.output,new RegExp(second)); await stopDev(run); assert.equal(alive(owner.pid),true);
});

test("an owner appearing before the final check is reused instead of spawning another Host", async t => {
  if (process.platform !== "linux") return t.skip("live process command lines use Linux /proc");
  const fixture=devFixture(t); writeFileSync(join(fixture.root,"gate-codex-pid"),""); const run=fixture.startDev(); await waitFor(()=>existsSync(join(fixture.root,"codex-pid"))); const owner=fixture.startHost(); await waitFor(()=>existsSync(join(fixture.root,"hosts"))); fixture.lock(owner.pid); writeFileSync(join(fixture.root,"release-codex-pid"),""); await waitFor(()=>existsSync(join(fixture.root,"workflow-pid"))||run.exitCode!==null); assert.equal(run.exitCode,null,run.output); await waitFor(()=>run.output.includes("Reusing dsh Host")); assert.equal(readFileSync(join(fixture.root,"hosts"),"utf8").trim().split("\n").length,1); await stopDev(run); assert.equal(alive(owner.pid),true);
});

test("Codex watcher exit before ready stops W and Host startup", async t => {
  const fixture=devFixture(t); writeFileSync(join(fixture.root,"fail-codex-pid"),""); const run=fixture.startDev(); await waitFor(()=>run.exitCode!==null||run.signalCode!==null); assert.equal(run.exitCode,2,run.output); assert.equal(existsSync(join(fixture.root,"workflow-pid")),false); assert.equal(existsSync(join(fixture.root,"hosts")),false);
});
