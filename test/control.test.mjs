import assert from "node:assert/strict";
import test from "node:test";

import { handoffPrompt, parseControlSignal } from "../lib/index.js";

const HANDOFF = [
  "Work in progress notes.",
  "",
  "Execution control: handoff",
  "Target tier: def",
  "Summary: opened the main path and verified the entry point.",
  "Remaining: finish the remaining tests and in-scope repairs.",
].join("\n");

test("a complete handoff report parses into its routable fields", () => {
  const signal = parseControlSignal(HANDOFF);
  assert.deepEqual(signal, {
    kind: "handoff",
    target: "def",
    summary: "opened the main path and verified the entry point.",
    remaining: "finish the remaining tests and in-scope repairs.",
  });
  assert.match(handoffPrompt(signal), /same coding_worker/);
  assert.match(handoffPrompt(signal), /Handoff summary:\nopened the main path/);
  assert.match(handoffPrompt(signal), /Do not hand off again/);
});

test("a complete consult report parses into its routable fields", () => {
  const signal = parseControlSignal([
    "Execution control: consult",
    "Question: which serialization keeps the wire format stable?",
    "Goal: preserve existing adapters.",
    "Choices: versioned envelope or additive field.",
    "Evidence: src/wire.ts:40 and the failing round-trip test.",
    "Expected conclusion: the option to implement and its compatibility rule.",
  ].join("\n"));
  assert.deepEqual(signal, {
    kind: "consult",
    question: "which serialization keeps the wire format stable?",
    goal: "preserve existing adapters.",
    choices: "versioned envelope or additive field.",
    evidence: "src/wire.ts:40 and the failing round-trip test.",
    expected: "the option to implement and its compatibility rule.",
  });
});

test("multi-line field values stay with their field", () => {
  const signal = parseControlSignal([
    "Execution control: handoff",
    "Target tier: def",
    "Summary: first line",
    "second line",
    "Remaining: only the migration test",
  ].join("\n"));
  assert.equal(signal?.kind, "handoff");
  assert.equal(signal?.kind === "handoff" && signal.summary, "first line\nsecond line");
});

test("an incomplete or prose-only report is not a control signal", () => {
  for (const text of [
    "The main path is complete, so I am switching configuration now.",
    "Execution control: handoff\nTarget tier: def\nSummary: opened it",
    "Execution control: handoff\nTarget tier: def\nTarget tier: def\nSummary: x\nRemaining: y",
    "Execution control: handoff\nTarget tier: sidecar\nSummary: x\nRemaining: y",
    "Execution control: consult\nQuestion: only one field",
    "",
  ]) assert.equal(parseControlSignal(text), undefined, JSON.stringify(text));
});
