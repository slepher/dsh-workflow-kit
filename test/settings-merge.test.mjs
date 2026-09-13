import assert from "node:assert/strict";
import test from "node:test";
import { WorkflowConfiguration, loadBuiltinProfiles, parseProfile } from "../lib/configuration.js";
import { ROLES } from "../lib/index.js";

/** Deterministic instruction resolver standing in for the installed skills. */
const instructions = role => `Instructions for ${role}`;
/** A role row as the shipped catalog declares it. */
const shipped = name => {
  const role = ROLES.find(candidate => candidate.name === name);
  return { provider: role.provider, model: role.model, reasoningEffort: role.effort };
};
/** One shipped configuration carrying a single reviewer row. */
const builtin = () => ({
  "gpt-workflow": parseProfile({ roles: { reviewer: { provider: "codex", model: "model-file", reasoningEffort: "high" } } }),
});
const configOf = (catalog, id) => catalog.view().configs.find(config => config.id === id);

test("a stored override replaces one role and leaves the rest inherited", () => {
  const catalog = new WorkflowConfiguration(builtin(), instructions);
  const before = configOf(catalog, "gpt-workflow");
  assert.deepEqual(before.roles.reviewer,
    { provider: "codex", model: "model-file", reasoningEffort: "high", overridden: false });
  // A role the shipped configuration omits resolves through the shipped role default.
  assert.deepEqual(before.roles.planner, { ...shipped("planner"), overridden: false });

  catalog.setUserConfigs({ "gpt-workflow": { roles: {
    reviewer: { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "max" },
  } } });
  const after = configOf(catalog, "gpt-workflow");
  assert.equal(after.builtin, true);
  assert.deepEqual(after.roles.reviewer,
    { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "max", overridden: true });
  assert.deepEqual(after.roles.planner, { ...shipped("planner"), overridden: false });
  // Execution captures the merged value, not the shipped file.
  assert.equal(catalog.capture("gpt-workflow", "reviewer").model, "deepseek-flash");
  assert.equal(catalog.capture("gpt-workflow", "reviewer").developerInstructions, "Instructions for reviewer");

  // Clearing the stored section reverts the configuration whole.
  catalog.setUserConfigs({});
  assert.deepEqual(configOf(catalog, "gpt-workflow").roles.reviewer,
    { provider: "codex", model: "model-file", reasoningEffort: "high", overridden: false });
});

test("a configuration with no shipped counterpart is a stored custom configuration", () => {
  const catalog = new WorkflowConfiguration(builtin(), instructions);
  catalog.setUserConfigs({ "my-config": { roles: {
    reviewer: { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "high" },
  } } });
  const custom = configOf(catalog, "my-config");
  assert.equal(custom.builtin, false);
  assert.equal(custom.roles.reviewer.overridden, true);
  // Every catalog role is present: the stored row, then the shipped default.
  assert.deepEqual(Object.keys(custom.roles).sort(), [...catalog.view().roleNames].sort());
  assert.deepEqual(custom.roles.planner, { ...shipped("planner"), overridden: false });

  // Removing it drops the configuration entirely.
  catalog.setUserConfigs({});
  assert.equal(configOf(catalog, "my-config"), undefined);
  assert.deepEqual(catalog.view().configs.map(config => config.id), ["gpt-workflow"]);
});

test("stored ids and roles outside the catalog are ignored", () => {
  const catalog = new WorkflowConfiguration(builtin(), instructions);
  catalog.setUserConfigs({
    "Bad Id": { roles: { reviewer: { provider: "p", model: "m", reasoningEffort: "high" } } },
    "known": { roles: {
      unknown_role: { provider: "p", model: "m", reasoningEffort: "high" },
      reviewer: { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "high" },
    } },
  });
  const known = configOf(catalog, "known");
  assert.deepEqual(catalog.view().configs.map(config => config.id).sort(), ["gpt-workflow", "known"]);
  assert.equal("unknown_role" in known.roles, false);
  assert.equal(known.roles.reviewer.model, "deepseek-flash");
});

test("the shipped catalog offers both provider classes with the translated effort split", () => {
  const shippedProfiles = loadBuiltinProfiles();
  assert.deepEqual(Object.keys(shippedProfiles).sort(), ["ds-workflow", "gpt-workflow"]);
  for (const [name, row] of Object.entries(shippedProfiles["gpt-workflow"].roles)) {
    assert.equal(row.provider, "codex", `${name} keeps the codex provider`);
  }
  for (const [name, row] of Object.entries(shippedProfiles["ds-workflow"].roles)) {
    assert.equal(row.provider, "deepseek-official", name);
    assert.equal(row.model, "deepseek-flash", name);
    assert.ok(["max", "high"].includes(row.reasoningEffort), `${name} carries a translated effort`);
  }
  // The codex high/medium split maps onto the DeepSeek max/high split.
  assert.equal(shippedProfiles["ds-workflow"].roles.planner.reasoningEffort, "max");
  assert.equal(shippedProfiles["ds-workflow"].roles.full_tester.reasoningEffort, "high");
});
