import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const codex = resolve(root, process.env.DSH_CODEX_KIT_CHECKOUT ?? "../dsh-codex-kit");
const { build } = createRequire(join(codex, "package.json"))("esbuild");

await build({
  entryPoints: [join(root, "src/client.tsx")],
  outfile: join(root, "lib/client.js"),
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  packages: "external",
  banner: { js: "window.__ModuleLoader__.load({ id: \"dsh-workflow-kit\", factory: (require) => { var module = { exports: {} }; var exports = module.exports;" },
  footer: { js: "return module.exports; } });" },
});
