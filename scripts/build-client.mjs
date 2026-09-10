import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));

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
