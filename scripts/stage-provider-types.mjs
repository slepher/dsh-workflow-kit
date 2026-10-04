// Stage the Codex provider's built package where this package's type checker
// resolves it.
//
// The provider is a runtime peer and the owner of the `codexExecution` and
// `codexToolGate` contracts this package imports as types. It cannot be a
// `file:` devDependency pointing at the adjacent checkout: pnpm runs
// `npm install` inside a fetched git package, where no sibling checkout exists,
// so such a spec fails the whole install with `ERR_PNPM_PREPARE_PACKAGE`
// instead of degrading.
//
// Staging reproduces what that devDependency used to provide, and only a copy
// nested under this package's own `node_modules` is equivalent: the provider's
// declarations augment `Context` through
// `declare module "@deepseek-ai/cordis"`, and a module augmentation merges only
// with the exact module instance it resolves to. Pointing at the adjacent
// checkout — by `paths` or by symlink — makes those declarations find the
// provider's own cordis copy and augment that one instead, leaving
// `ctx.codexExecution` unknown here.
//
// `npm ci` prunes the staged copy, so `npm run prepare:local` runs this after
// it. Nothing here reaches a git install: that path builds with `prepare`,
// which transpiles without a type checker.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));

/**
 * Copy one built provider checkout into this package's `node_modules`.
 * @param options - staging inputs.
 * @param options.root - this package's directory; defaults to its own.
 * @param options.checkout - the provider checkout; defaults to
 *   `DSH_CODEX_APP_PROVIDER_CHECKOUT`, then the adjacent `../dsh-codex-app-provider`.
 * @param options.log - sink for the one success line.
 * @returns the staged package directory.
 */
export function stageProviderTypes({ root = defaultRoot, checkout = process.env.DSH_CODEX_APP_PROVIDER_CHECKOUT ?? join(root, "..", "dsh-codex-app-provider"), log = console.log } = {}) {
  const declarations = join(checkout, "lib", "index.d.ts");
  if (!existsSync(declarations)) throw new Error(`Build the Codex provider before staging its declarations: ${checkout}`);
  const manifest = JSON.parse(readFileSync(join(checkout, "package.json"), "utf8"));
  const target = join(root, "node_modules", manifest.name);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(join(checkout, "lib"), join(target, "lib"), { recursive: true });
  // Only the fields module resolution reads: the staged copy is an input to the
  // type checker, never a dependency anyone imports at runtime.
  writeFileSync(join(target, "package.json"), `${JSON.stringify({
    name: manifest.name,
    version: manifest.version,
    type: manifest.type,
    main: manifest.main,
    types: manifest.types,
    exports: manifest.exports,
  }, null, 2)}\n`);
  log(`${manifest.name}@${manifest.version} staged for type checking`);
  return target;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) stageProviderTypes();
