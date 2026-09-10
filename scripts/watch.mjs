import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
let current;
let pending = false;
let stopped = false;

const rebuild = () => {
  if (current || stopped || !pending) return;
  pending = false;
  current = spawn("npm", ["run", "build"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  current.once("exit", code => {
    current = undefined;
    if (code !== 0) process.exitCode = code ?? 1;
    rebuild();
  });
};

const watcher = watch(new URL("../src/", import.meta.url), { recursive: true }, () => {
  pending = true;
  rebuild();
});
console.log("dsh-workflow-kit watch ready");

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  stopped = true;
  watcher.close();
  current?.kill("SIGINT");
});
