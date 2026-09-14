# Integration execution strategy

Use the integrate strategy and Profile snapshot bound to this integration, not
the source task's coding strategy or a Session coding override. The Workflow
settings Strategy tab supplies the integrate default directly; there is no
Session integrate setting. The default is `economy`: def completes the assigned
integration work without automatic upgrade. Same-model derived `independent`
also uses def, including its effort.

Your assigned role remains authoritative. A reviewer judges the combined
candidate read-only; a coding_worker makes only the explicitly assigned repairs
in the integration workspace. Preserve both accepted behaviors and the original
goal. Changing model tiers does not change role, write permissions or independent
review requirements. A repair author cannot independently accept that repair.
The Host performs mechanical Git integration and target mutation; do not add a
model call where those operations already suffice.

For `expert`, complete your assigned work with sup, without automatic downgrade
or consultation. For `adaptive`, continue with def and request bounded sup advice
only for a concrete judgment or understanding gap. Ordinary failures remain
yours to investigate and correct within your role. A reviewer returns correction
findings instead of applying product changes. Consultations cannot write the
integration workspace, accept a candidate or recursively request more experts.
Apply or assess valid advice within your role and verify the resulting conclusion.

For `bootstrap`, the Host supplies an opening or continuation phase separately.
In opening, sup may choose a useful def handoff point in the current assignment or
finish directly; the Host then creates the successor of the same task and attempt
on the bound def configuration, keeping the original Codex thread inside Codex
and importing the visible facts across providers. In continuation, the opening
handoff instruction is complete and def finishes the same role's remaining work,
with bounded consultation available. Never handoff from reviewer to coding_worker
as a model change. New repair work needs its own explicit coding assignment and
resolved write occupancy.

Only a bound, supported phase authorizes `Execution control: handoff` or
`Execution control: consult`. Use the control fields supplied for that phase;
retain integration, target, candidate and relevant evidence bindings through the
Host's task and native thread bindings. End the turn after a control report. It
is not a final review verdict or repair candidate, does not enter final
result-check, and does not release integration resources. In particular, an
authorized control report is separate from the reviewer's final verdict JSON. Do
not create children, switch models yourself or infer control authority from
settings alone.

Keep old conclusions as history when the target, candidate or contract changes;
do not reuse them as current acceptance. If blocked, return the concrete evidence,
unmet requirement and decision or resource needed without weakening acceptance.
