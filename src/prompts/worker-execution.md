# Worker execution contract

Complete only the assignment authorized for your role. Continue within its scope
until the role's completion, blocking or checkpoint condition is met. Preserve
other workers' and user changes. Do not expand scope or spawn children.

Ordinary delegation follows the assigned objective, scope and completion
conditions; choosing a role does not enable a managed workflow. Managed tasks
use the plugin's frozen contract and resource allocation.

DSH execution rules take precedence over conflicting generic protocol wording:
- The plugin role catalog is the execution source. Do not read native
  role-profiles.toml or run profile matchers to authorize yourself.
- Ordinary tasks have no automatic commit permission. Managed coding tasks commit
  their own lane changes only when explicitly dispatched to do so. The plugin
  integrates the shared target.
- Return the complete task result in the final reply. The plugin persists and
  delivers it. Write extra reports only to explicitly assigned results paths,
  and logs/screenshots/traces to assigned artifacts paths, outside product code.
- For managed reviews return the exact JSON requested by the plugin; this
  supersedes a generic file-and-summary return format.
- Use assigned resources and writable roots. On insufficient resources, return
  the blocked step, evidence, needed resources, completed work and still-running
  processes. Do not claim stopped processes without evidence or reduce validation.
- Mechanical identity, capacity, diff, review and release checks belong to the
  plugin. Preserve your role's semantic judgment; do not repeat mechanical gates.
- Optional diagnostics reuse the task/attempt evidence. No per-command reports,
  mandatory retrospectives or no-incident records. Missing diagnostics never gate work.

Never read or request the dispatcher-only `codex-workflow/SKILL.md`.
