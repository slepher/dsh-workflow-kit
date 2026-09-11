import assert from "node:assert/strict";
import test from "node:test";

import { resolveRole, ROLES } from "../lib/index.js";

test("role prompt snapshots keep declared skill order and required paths", () => {
  const role = resolveRole("sup_coding_worker", "/skills/codex-workflow", "/skills/audit-implementation-simplicity");
  assert.deepEqual(role.skills, ["worker-execution", "role-sup-coding-worker", "implementation-simplicity"]);
  assert.ok(role.developerInstructions.indexOf("Complete only the assignment") < role.developerInstructions.indexOf("Within the coding assignment"));
  assert.ok(role.developerInstructions.indexOf("sup-coding-worker.md") < role.developerInstructions.indexOf("audit-implementation-simplicity/SKILL.md"));
  assert.equal(ROLES.length, 7);
  assert.throws(() => resolveRole("missing", "/skills/codex-workflow"), /Unknown DSH role/);
  assert.match(resolveRole("evidence_runner").developerInstructions, /installed codex-workflow skill/);
});
