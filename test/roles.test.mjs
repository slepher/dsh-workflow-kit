import assert from "node:assert/strict";
import test from "node:test";

import { resolveRole, ROLES, CONFIG_KEYS, CODING_WORKER } from "../lib/index.js";

test("role prompt snapshots keep declared skill order and required paths", () => {
  const role = resolveRole(CODING_WORKER, "/skills/codex-workflow", "/skills/audit-implementation-simplicity");
  assert.deepEqual(role.skills, ["worker-execution", "role-coding-worker", "implementation-simplicity"]);
  assert.ok(role.developerInstructions.indexOf("Complete only the assignment") < role.developerInstructions.indexOf("Coding worker role protocol"));
  assert.ok(role.developerInstructions.indexOf("coding-worker.md") < role.developerInstructions.indexOf("audit-implementation-simplicity/SKILL.md"));
  assert.equal(ROLES.length, 6);
  assert.equal(ROLES.some(candidate => candidate.name === "def_coding_worker" || candidate.name === "sup_coding_worker"), false, "tiers are configuration keys, not execution roles");
  assert.throws(() => resolveRole("missing", "/skills/codex-workflow"), /Unknown DSH role/);
  assert.match(resolveRole("evidence_runner").developerInstructions, /installed codex-workflow skill/);
});

test("phase prompt skills are appended after the role's long-lived responsibilities", () => {
  const role = resolveRole(CODING_WORKER, "/skills/codex-workflow", undefined, ["coding-adaptive"]);
  assert.deepEqual(role.skills, ["worker-execution", "role-coding-worker", "implementation-simplicity"]);
  assert.ok(role.developerInstructions.indexOf("Coding worker role protocol") < role.developerInstructions.indexOf("Adaptive coding execution"));
});

test("the configuration-key catalog keeps the legacy coding keys the settings page edits", () => {
  assert.deepEqual([...CONFIG_KEYS], ["planner", "reviewer", "context_collector", "def_coding_worker", "sup_coding_worker", "evidence_runner", "full_tester"]);
  assert.equal(CONFIG_KEYS.includes(CODING_WORKER), false);
});
