# dsh-workflow-kit boundaries

`dsh-workflow-kit` depends only on public exports from the adjacent
`dsh-codex-kit-backend` package. It does not import `dsh-codex-kit` client or
internal backend source.

The backend owns Codex process/connection lifecycle and publishes execution
identity and terminal state. This package owns worker roles and prompts, parent
association, ordinary delegation tools, managed workflow state, task attempts,
lanes, review/integration constraints, report delivery, acknowledgement,
acceptance, release, and git workflow.

Ordinary delegation supports create, append, steer, interrupt, query, resume,
report, acknowledgement, acceptance, and close without a workflow contract.
Managed execution must enter through workflow-owned constraint calls and cannot
use ordinary tools to bypass lanes, review, integration, or acceptance.

Reports and acceptance state are durable here. Backend terminal events carry
Session/thread/turn identity so this package can reconcile after restart.
Repeated terminal events produce one report. Delivery is at least once and ack
is associated with report identity. Notification, query, ack, acceptance, and
release remain separate state transitions.

The Host tools can execute without a browser. The packaged client is the full
visual worker UI; it submits user actions through authenticated Host APIs and
never mutates acceptance state directly.
