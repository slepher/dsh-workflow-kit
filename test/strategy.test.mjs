import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  WorkflowConfiguration, WorkflowSettingsSchema, WorkflowStore,
  bindCodingStrategy, bindIntegrateStrategy, snapshotProfile, tierConfigKey,
} from "../lib/index.js";

/** Deterministic instruction resolver standing in for the installed skills. */
const instructions = role => `Instructions for ${role}`;

/** A configuration with distinct sup/def coding models. */
const distinct = () => new WorkflowConfiguration({ a: { roles: {
  planner: { provider: "codex", model: "planner-model", reasoningEffort: "high" },
  reviewer: { provider: "codex", model: "review-model", reasoningEffort: "high" },
  def_coding_worker: { provider: "codex", model: "def-model", reasoningEffort: "medium" },
  sup_coding_worker: { provider: "codex", model: "sup-model", reasoningEffort: "high" },
} } }, instructions);

/** A configuration whose sup/def rows share one provider and model. */
const shared = (effort = "low") => new WorkflowConfiguration({ a: { roles: {
  def_coding_worker: { provider: "codex", model: "same-model", reasoningEffort: "medium" },
  sup_coding_worker: { provider: "codex", model: "same-model", reasoningEffort: effort },
} } }, instructions);

test("each strategy binds the configuration tier and phase prompts the design names", () => {
  const profile = distinct().profile("a");
  const economy = bindCodingStrategy(profile, "economy");
  assert.deepEqual([economy.effective, economy.tier, economy.handoff, economy.consult, economy.prompts],
    ["independent", "def", false, false, ["coding-independent"]]);
  const expert = bindCodingStrategy(profile, "expert");
  assert.deepEqual([expert.effective, expert.tier, expert.handoff, expert.consult, expert.prompts],
    ["independent", "sup", false, false, ["coding-independent"]]);
  const adaptive = bindCodingStrategy(profile, "adaptive");
  assert.deepEqual([adaptive.effective, adaptive.tier, adaptive.handoff, adaptive.consult, adaptive.prompts],
    ["adaptive", "def", false, true, ["coding-adaptive"]]);
  const opening = bindCodingStrategy(profile, "bootstrap");
  assert.deepEqual([opening.effective, opening.tier, opening.handoff, opening.consult, opening.prompts],
    ["bootstrap", "sup", true, false, ["coding-bootstrap-opening"]]);
  const continuation = bindCodingStrategy(profile, "bootstrap", "continuation");
  assert.deepEqual([continuation.effective, continuation.tier, continuation.handoff, continuation.consult, continuation.prompts],
    ["bootstrap", "def", false, true, ["coding-bootstrap-continuation", "coding-adaptive"]]);
  const consultation = bindCodingStrategy(profile, "adaptive", "consultation");
  assert.deepEqual([consultation.effective, consultation.tier, consultation.prompts],
    ["independent", "sup", ["coding-consultation"]]);
  // A Session with no override inherits the coding default.
  assert.equal(bindCodingStrategy(profile, undefined).requested, "adaptive");
});

test("same-model profiles fix independent execution without discarding the preference", () => {
  const profile = shared("ultra").profile("a");
  for (const requested of ["adaptive", "bootstrap", "expert", "economy"]) {
    const binding = bindCodingStrategy(profile, requested);
    assert.equal(binding.sameModel, true, requested);
    assert.equal(binding.effective, "independent", requested);
    assert.equal(binding.tier, "def", `${requested} runs the def configuration`);
    assert.equal(binding.handoff, false, requested);
    assert.equal(binding.consult, false, requested);
    assert.deepEqual(binding.prompts, ["coding-independent"], requested);
    assert.equal(binding.requested, requested, "the preference is retained for a later profile switch");
  }
  // Effort is not part of the identity test, and the derived execution uses def's effort.
  assert.equal(shared("ultra").profile("a").roles.def_coding_worker.reasoningEffort, "medium");
});

test("a snapshot resolves the same binding after a Profile edit or restart", () => {
  const catalog = distinct();
  const snapshot = catalog.codingSnapshot("a");
  const binding = bindCodingStrategy(snapshotProfile(snapshot), "adaptive");
  assert.deepEqual([binding.effective, binding.tier], ["adaptive", "def"]);
  catalog.setUserConfigs({ a: { roles: { def_coding_worker: { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "max" } } } });
  assert.equal(catalog.capture("a", "coding_worker", undefined, { configKey: tierConfigKey("def") }).model, "deepseek-flash");
  assert.equal(catalog.captureSnapshot("coding_worker", snapshot, "def").model, "def-model", "the snapshot is not rewritten");
});

test("integrate resolves from the integrate setting and never from a Session coding override", () => {
  const catalog = distinct();
  const setting = bindIntegrateStrategy(catalog.profile("a"), catalog.strategies().integrate);
  assert.deepEqual([setting.requested, setting.effective, setting.tier, setting.prompts], ["economy", "independent", "def", ["integrate-execution"]]);
  const expert = bindIntegrateStrategy(catalog.profile("a"), "expert");
  assert.deepEqual([expert.tier, expert.prompts], ["sup", ["integrate-execution"]]);
});

test("the settings schema defaults the two strategies independently", () => {
  // The volatile fields resolve to references; the value is read from each one.
  const empty = WorkflowSettingsSchema({});
  assert.equal(empty.codingStrategy.get(), "adaptive");
  assert.equal(empty.integrateStrategy.get(), "economy");
  const stored = WorkflowSettingsSchema({ codingStrategy: "expert", integrateStrategy: "bootstrap" });
  assert.deepEqual([stored.codingStrategy.get(), stored.integrateStrategy.get()], ["expert", "bootstrap"]);
  assert.equal(WorkflowSettingsSchema({ codingStrategy: "expert" }).integrateStrategy.get(), "economy", "one change never overwrites the other");
  assert.throws(() => WorkflowSettingsSchema({ codingStrategy: "turbo" }));
});

test("Session strategy overrides persist next to profile selections and never disturb them", t => {
  const stateDir = mkdtempSync(join(tmpdir(), "workflow-strategy-")); t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const store = new WorkflowStore(stateDir);
  store.selectProfile("session-1", "gpt-workflow");
  assert.equal(store.strategyPreference("session-1"), undefined, "no override means inherit the stored default");
  store.selectStrategy("session-1", "expert");
  store.selectStrategy("session-2", "economy");
  const reloaded = new WorkflowStore(stateDir);
  assert.equal(reloaded.strategyPreference("session-1"), "expert");
  assert.equal(reloaded.strategyPreference("session-2"), "economy");
  assert.equal(reloaded.selectedProfile("session-1"), "gpt-workflow", "profile selection is untouched");
  reloaded.selectStrategy("session-1", undefined);
  assert.equal(new WorkflowStore(stateDir).strategyPreference("session-1"), undefined, "clearing restores the default");
});
