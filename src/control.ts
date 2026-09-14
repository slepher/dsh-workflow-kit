/**
 * Execution control reports.
 *
 * A bound phase may authorize a worker to end its turn with a control report
 * instead of a final result. The report carries the decision the Host routes
 * mechanically; it never replaces acceptance, a candidate, or a final result.
 */

/** The tiers a handoff may target. */
export type ControlTier = "def" | "sup";

/** A bounded handoff from an opening phase to the tier that continues it. */
export interface HandoffSignal {
  kind: "handoff";
  /** Tier the worker continues on. */
  target: ControlTier;
  /** Completed work, key decisions and actual validation. */
  summary: string;
  /** Remaining work, relevant locations and necessary cautions. */
  remaining: string;
}

/** A bounded request for expert judgment on one concrete question. */
export interface ConsultSignal {
  kind: "consult";
  question: string;
  goal: string;
  choices: string;
  evidence: string;
  expected: string;
}

export type ControlSignal = HandoffSignal | ConsultSignal;

const HANDOFF_FIELDS = ["Target tier", "Summary", "Remaining"] as const;
const CONSULT_FIELDS = ["Question", "Goal", "Choices", "Evidence", "Expected conclusion"] as const;

/** One control report's fields, or `undefined` when the reply carries no report. */
function fields(text: string): { kind: string; values: Record<string, string> } | undefined {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => /^\s*Execution control:\s*(handoff|consult)\s*$/i.test(line));
  if (start === -1) return undefined;
  const kind = /^\s*Execution control:\s*(handoff|consult)\s*$/i.exec(lines[start]!)?.[1]?.toLowerCase() ?? "";
  const expected: readonly string[] = kind === "handoff" ? HANDOFF_FIELDS : CONSULT_FIELDS;
  const values: Record<string, string> = {};
  let current: string | undefined;
  for (const line of lines.slice(start + 1)) {
    const match = /^\s*([A-Za-z][A-Za-z ]*):\s*(.*)$/.exec(line);
    if (match !== null && expected.includes(match[1]!.trim())) {
      const name = match[1]!.trim();
      // A repeated field makes the report ambiguous; treat it as no report.
      if (values[name] !== undefined) return undefined;
      current = name;
      values[current] = match[2]!.trim();
      continue;
    }
    if (current === undefined) {
      // Text before the first known field, or a stray line, ends the report.
      if (line.trim() !== "") return undefined;
      continue;
    }
    // A blank line separates the control report from surrounding result prose.
    if (line.trim() === "") break;
    values[current] = `${values[current] ?? ""}\n${line}`.trim();
  }
  return { kind, values };
}

/**
 * Parse the control report one execution ended its turn with.
 *
 * A report is honored only when it is complete: a missing or empty field makes
 * the whole signal absent, so the Host falls back to the ordinary final-result
 * path instead of guessing intent from prose.
 * @param text - the worker's final reply for one completed turn.
 * @returns the parsed signal, or `undefined` when the turn carried none.
 */
export function parseControlSignal(text: string): ControlSignal | undefined {
  const parsed = fields(text);
  if (parsed === undefined) return undefined;
  const values = parsed.values;
  if (parsed.kind === "handoff") {
    if (HANDOFF_FIELDS.some(field => !values[field]?.trim())) return undefined;
    const target = values["Target tier"]!.trim().toLowerCase();
    if (target !== "def" && target !== "sup") return undefined;
    return { kind: "handoff", target, summary: values.Summary!, remaining: values.Remaining! };
  }
  if (CONSULT_FIELDS.some(field => !values[field]?.trim())) return undefined;
  return {
    kind: "consult",
    question: values.Question!,
    goal: values.Goal!,
    choices: values.Choices!,
    evidence: values.Evidence!,
    expected: values["Expected conclusion"]!,
  };
}

/**
 * Build the continuation prompt the Host binds with a handoff.
 *
 * The prompt states the phase facts the worker cannot infer: the opening
 * instruction is fulfilled, the original goal and contract still apply, and
 * the bound configuration changed without changing the assignment. When the
 * handoff also changes provider adapter, the sourced executed facts of the
 * previous adapter are carried here, because the native thread does not
 * survive that boundary.
 * @param signal - the parsed handoff report.
 * @param facts - sourced executed facts to import; omit when the native thread continues.
 * @returns the continuation prompt for the same worker's next turn.
 */
export function handoffPrompt(signal: HandoffSignal, facts?: readonly string[]): string {
  return [
    "Continue as the same coding_worker; the opening phase handed the assignment to the bound def configuration.",
    "The original goal, frozen contract, ownership, permissions and acceptance still apply; the opening downgrade instruction is fulfilled and does not apply again.",
    "Use the existing thread context and the handoff facts below to complete the remaining implementation, testing and in-scope repairs.",
    "Read additional evidence only as needed; do not rebuild the task or repeat an entire validation pass because the model changed.",
    "",
    "Handoff summary:",
    signal.summary,
    "",
    "Remaining work:",
    signal.remaining,
    "",
    "Do not hand off again. Request bounded consultation only for a new concrete knowledge or judgment gap, and otherwise continue until the assignment is complete or a concrete blocker requires a return.",
    ...(facts === undefined ? [] : [
      "",
      "Executed facts imported from the previous adapter (already performed; do not re-run them):",
      ...(facts.length === 0
        ? ["No executed facts were recorded before the switch; rely on the session history and the handoff summary above."]
        : [...facts, "", "Long native output was shortened and remains addressable by the item identity shown on each line."]),
    ]),
  ].join("\n");
}
