import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("../", import.meta.url));
const codex = resolve(root, process.env.DSH_CODEX_KIT_CHECKOUT ?? "../dsh-codex-kit");
const temp = mkdtempSync(join(tmpdir(), "dsh-workflow-kit-pack-"));
const installedDshPackage = /(?:^|\/)node_modules\/@deepseek-ai\/dsh-[^/]+$/;

try {
  const pack = (cwd, workspace) => JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", temp, ...(workspace ? ["-w", workspace] : [])], { cwd, encoding: "utf8" }))[0].filename;
  const backend = join(temp, pack(codex, "dsh-codex-kit-backend"));
  const ui = join(temp, pack(codex, "dsh-codex-kit"));
  const workflow = join(temp, pack(root));
  const sourceLocks = [join(codex, "package-lock.json"), join(root, "package-lock.json")]
    .map(path => JSON.parse(readFileSync(path, "utf8")));
  const dsh = Object.fromEntries(sourceLocks.flatMap(lock => Object.entries(lock.packages))
    .filter(([path, value]) => /^node_modules\/@deepseek-ai\/dsh-[^/]+$/.test(path) && value.version === "0.1.5-rc.1")
    .map(([path, value]) => [path.slice("node_modules/".length), value.version]));
  writeFileSync(join(temp, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    dependencies: {
      ...dsh,
      react: "18.3.1",
      "react-dom": "18.3.1",
      "dsh-codex-kit-backend": `file:${backend}`,
      "dsh-codex-kit": `file:${ui}`,
      "dsh-workflow-kit": `file:${workflow}`,
    },
  }));
  execFileSync("npm", ["install", "--prefer-offline", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: temp, stdio: "inherit" });
  const installedLock = JSON.parse(readFileSync(join(temp, "package-lock.json"), "utf8"));
  for (const [path, value] of Object.entries(installedLock.packages)) {
    if (installedDshPackage.test(path) && value.version !== "0.1.5-rc.1") throw new Error(`${path} resolved ${value.version}`);
  }
  const [backendEntry, codexEntry, workflowEntry] = await Promise.all([
    import(pathToFileURL(join(temp, "node_modules/dsh-codex-kit-backend/lib/index.js"))),
    import(pathToFileURL(join(temp, "node_modules/dsh-codex-kit/lib/index.js"))),
    import(pathToFileURL(join(temp, "node_modules/dsh-workflow-kit/lib/index.js"))),
  ]);
  if (typeof backendEntry.CodexSessionBackend !== "function" || typeof codexEntry.apply !== "function" || typeof workflowEntry.apply !== "function") process.exit(1);

  const materialize = (name, require) => {
    let registration;
    vm.runInNewContext(readFileSync(join(temp, `node_modules/${name}/lib/client.js`), "utf8"), {
      document: { createElement: () => ({ remove() {} }), head: { append() {} } },
      window: { __ModuleLoader__: { load: value => { registration = value; } } },
    });
    const plugin = registration?.factory(require);
    if (registration?.id !== name || typeof plugin?.apply !== "function") process.exit(1);
  };
  materialize("dsh-codex-kit", id => id === "@deepseek-ai/dsh-client-store"
    ? { createSnapshotStore: initial => ({ getSnapshot: () => initial, set() {}, subscribe: () => () => {} }) }
    : id === "react/jsx-runtime" ? { jsx() {}, jsxs() {} } : {});
  const require = createRequire(join(temp, "package.json"));
  materialize("dsh-workflow-kit", id => id === "@deepseek-ai/dsh-client-ui-primitives"
    ? {
        MarkdownText() {}, IconDatabaseOutline16() {}, IconClockOutline16() {}, IconGaugeOutline16() {},
        IconCopyOutline16() {}, IconCheckOutline16() {}, writeClipboard: async () => true,
        useAnchoredPosition: () => null, useAnchoredMaxHeight: () => 320, useDismissOnOutsidePointer() {},
      }
    : require(id));
  console.log("dsh workflow three-tarball install ok");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
