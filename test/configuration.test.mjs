import assert from "node:assert/strict";
import test from "node:test";
import { WorkflowConfiguration, loadBuiltinProfiles, parseProfile, roleInstructions } from "../lib/configuration.js";
import { CONFIG_KEYS } from "../lib/index.js";

/** Deterministic instruction resolver standing in for the installed skills. */
const instructions = role => `Instructions for ${role}`;
const profile = roles => ({ roles });

test("the shipped configuration files are the only catalog and carry every key", () => {
  const builtin = loadBuiltinProfiles();
  assert.deepEqual(Object.keys(builtin).sort(), ["ds-workflow", "gpt-workflow"]);
  for (const [id, builtinProfile] of Object.entries(builtin)) {
    assert.deepEqual(Object.keys(builtinProfile.roles).sort(), [...CONFIG_KEYS].sort(), `${id} carries the fixed key catalog`);
  }
});

test("capture resolves the effective role and composes instructions at call time", () => {
  const catalog = new WorkflowConfiguration(loadBuiltinProfiles(),
    roleInstructions("/skills/codex-workflow", "/skills/audit-implementation-simplicity"));
  const captured = catalog.capture("gpt-workflow", "planner");
  assert.equal(captured.provider, "codex");
  assert.equal(captured.model, "gpt-6-astra");
  // The deployment's installed skill layout decides the instruction paths.
  assert.ok(captured.developerInstructions.includes("/skills/codex-workflow/references/roles/planner.md"));
  assert.ok(captured.developerInstructions.includes("/skills/audit-implementation-simplicity/SKILL.md"));
  assert.throws(() => catalog.capture(undefined, "planner"), /No workflow profile/);
  assert.throws(() => catalog.capture("missing", "planner"), /unavailable/);
  // The role set is fixed, so an unknown role is simply absent from every profile.
  assert.throws(() => catalog.capture("gpt-workflow", "not_a_role"), /lacks required roles/);
});

test("a captured execution is detached from later stored-layer changes", () => {
  const catalog = new WorkflowConfiguration(
    { a: profile({ planner: { provider: "p", model: "model-a", reasoningEffort: "high" } }) }, instructions);
  const captured = catalog.capture("a", "planner");
  catalog.setUserConfigs({ a: { roles: { planner: { provider: "p", model: "model-b", reasoningEffort: "low" } } } });
  assert.deepEqual(captured,
    { provider: "p", model: "model-a", reasoningEffort: "high", developerInstructions: "Instructions for planner" });
  assert.equal(catalog.capture("a", "planner").model, "model-b");
});

test("configuration parsing rejects unknown fields and incomplete mappings", () => {
  for (const value of [
    { roles: {}, extra: true },
    { roles: { planner: { model: "m", reasoningEffort: "high" } } },
    { roles: { planner: { provider: "p", model: "m" } } },
    { roles: { planner: { provider: "p", model: "m", reasoningEffort: "high", extra: true } } },
    { roles: { planner: { provider: "  ", model: "m", reasoningEffort: "high" } } },
    { roles: { planner: { provider: "p", model: "m", reasoningEffort: "sometimes" } } },
    { roles: { "Bad Id": { provider: "p", model: "m", reasoningEffort: "high" } } },
  ]) assert.throws(() => parseProfile(value));
  assert.deepEqual(parseProfile({ roles: { planner: { provider: "p", model: "m", reasoningEffort: "high" } } }).roles.planner,
    { provider: "p", model: "m", reasoningEffort: "high" });
});

test("the role set is fixed and unrelated stored roles are ignored", () => {
  const catalog = new WorkflowConfiguration({}, instructions);
  catalog.setUserConfigs({ custom: { roles: {
    not_a_role: { provider: "p", model: "m", reasoningEffort: "high" },
    planner: { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "max" },
  } } });
  const custom = catalog.view().configs.find(config => config.id === "custom");
  assert.deepEqual(Object.keys(custom.roles).sort(), [...catalog.view().roleNames].sort());
  assert.equal("not_a_role" in custom.roles, false);
  assert.equal(custom.roles.planner.model, "deepseek-flash");
  assert.equal(custom.builtin, false);
});
