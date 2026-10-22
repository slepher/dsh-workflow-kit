// Release build used by `prepack`.
//
// npm and pnpm both run `prepack` before a tarball is produced, and pnpm also
// runs it while preparing a git-hosted install. A release checkout has the
// Codex provider's declarations staged by `npm run prepare:local`, so the full
// `npm run build` type-checks and emits declarations. A git install has only
// the fetched package, so no provider declarations exist; there the
// self-contained `prepare-build.mjs` (esbuild, no type checker) is the only
// build that can run.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const providerDeclarations = fileURLToPath(new URL("../node_modules/dsh-codex-app-provider/lib/index.d.ts", import.meta.url));

const command = existsSync(providerDeclarations)
  ? ["npm", ["run", "build"]]
  : ["node", [fileURLToPath(new URL("./prepare-build.mjs", import.meta.url))]];

const result = spawnSync(command[0], command[1], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
