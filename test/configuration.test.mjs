import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowConfiguration, configurationDirectory, parseProfile, installConfiguration } from "../lib/configuration.js";
import { ROLES } from "../lib/roles.js";

test("profile capture is detached, reload isolates bad files and never falls back", t => {
  const home = mkdtempSync(join(tmpdir(), "workflow-profile-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const directory = configurationDirectory("workflow-kit", home);
  mkdirSync(join(directory, "roles"), { recursive: true });
  mkdirSync(join(directory, "profiles"));
  writeFileSync(join(directory, "roles/reviewer.md"), "A instructions");
  const profile = model => JSON.stringify({ roles: { reviewer: { model, reasoningEffort: "high" } } });
  writeFileSync(join(directory, "profiles/a.json"), profile("model-a"));
  writeFileSync(join(directory, "profiles/b.json"), profile("model-b"));
  const catalog = new WorkflowConfiguration("workflow-kit", home);
  const a = catalog.capture("a", "reviewer");
  assert.equal(catalog.capture("b", "reviewer").model, "model-b");
  writeFileSync(join(directory, "roles/reviewer.md"), "B instructions");
  writeFileSync(join(directory, "profiles/a.json"), "invalid");
  catalog.reload();
  assert.deepEqual(a, { model: "model-a", reasoningEffort: "high", developerInstructions: "A instructions" });
  assert.equal(catalog.capture("b", "reviewer").developerInstructions, "B instructions");
  assert.throws(() => catalog.capture("a", "reviewer"), /unavailable/);
  assert.throws(() => catalog.capture(undefined, "reviewer"), /No workflow profile/);
  assert.throws(() => catalog.capture("b", "reviewer", ["planner"]), /required roles/);
  assert.equal(catalog.view(["planner"]).profiles[0].missingRequiredRoles[0], "planner");
  assert.equal(catalog.view().diagnostics[0].file, "profiles/a.json");
  symlinkSync(join(directory, "roles/reviewer.md"), join(directory, "roles/linked.md"));
  catalog.reload();
  assert.ok(catalog.view().diagnostics.some(item => item.file === "roles/linked.md"));
});

test("configuration rejects escape paths and strict mapping errors", t => {
  const home = mkdtempSync(join(tmpdir(), "workflow-path-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  for (const path of ["", ".", "../escape", "/tmp/escape", "nested/../escape"]) assert.throws(() => configurationDirectory(path, home));
  symlinkSync(tmpdir(), join(home, "escape"));
  assert.throws(() => configurationDirectory("escape/new", home), /symlink/);
  for (const value of [{ roles: {}, extra: true }, { roles: { reviewer: { model: "m" } } }, { roles: { reviewer: { model: "m", reasoningEffort: "high", extra: true } } }]) assert.throws(() => parseProfile(value));
  assert.equal(new WorkflowConfiguration("missing", home).view().profiles.length, 0);
});

test("explicit installation validates references and preserves modified and custom files", t => {
  const home = mkdtempSync(join(tmpdir(), "workflow-install-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const skills = join(home, "skills"), standard = join(home, "standard");
  mkdirSync(join(skills, "references/roles"), { recursive: true });
  mkdirSync(standard);
  writeFileSync(join(standard, "SKILL.md"), "standard");
  const catalog = new WorkflowConfiguration("config", home);
  assert.throws(() => installConfiguration(catalog, skills, standard), /ENOENT/);
  assert.equal(existsSync(join(home, "config")), false);
  for (const role of ROLES) writeFileSync(join(skills, "references/roles", role.protocol), role.name);
  installConfiguration(catalog, skills, standard);
  assert.equal(catalog.view().profiles.length, 1);
  assert.equal(Object.keys(catalog.view().profiles[0].roles).length, 7);
  assert.ok(catalog.capture("workflow-default", "reviewer").developerInstructions.includes(skills));
  installConfiguration(catalog, skills, standard);
  const roleFile = join(home, "config/roles/reviewer.md");
  writeFileSync(roleFile, "user changed this");
  writeFileSync(join(home, "config/roles/custom.md"), "custom instructions");
  assert.throws(() => installConfiguration(catalog, skills, standard), /Preserved.*reviewer.md/);
  assert.equal(readFileSync(roleFile, "utf8"), "user changed this");
  assert.equal(readFileSync(join(home, "config/roles/custom.md"), "utf8"), "custom instructions");
});
