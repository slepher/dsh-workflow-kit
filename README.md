# dsh-workflow-kit

`dsh-workflow-kit` adds managed workflow execution, roles, prompts, skills, and CLI support to DSH. It consumes worker and report facts from the public `dsh-codex-kit-backend` API; the Codex worker UI belongs to `dsh-codex-kit`.

## Runtime configuration

Load `dsh-codex-kit-backend` first so the host provides `ctx.codexKit.backend`, then load this package with:

- `stateDir`: an absolute directory dedicated to new workflow state.
- `workflowSkillDir`: the absolute installed `codex-workflow` skill directory. Role protocol files are resolved below `references/roles/`.
- `implementationStandardDir`: optional absolute `audit-implementation-simplicity` skill directory. By default it is resolved beside `workflowSkillDir`.

Do not point `stateDir` at a previous `dsh-subagents-codex` deployment. Backend Session/thread state remains backend-owned; this package persists worker projections, terminal reports, acknowledgements, acceptance, plans, attempts, lanes, reviews, integration, delivery, and release.

The host registers two tools:

- `codex_workers`: ordinary create, roles, list, get, reports, append, steer, interrupt, resume, accept, ack, and close.
- `codex_workflow`: adopt, status, dispatch, record-result, accept, integrate, resolve, resolved, continue, refresh-integration, archive, and release.

Managed worker mutation and occupied lane creation are rejected through the backend's global mutation guard. Reports are persisted before notification, terminal events are reconciled by durable sequence after restart, and duplicate terminal events retain one report per worker/turn. Notification, acknowledgement, acceptance, delivery, and release are distinct states.

## Build and test

Requires Node.js 22.19 or newer, DSH `0.1.5-rc.1`, `dsh-codex-kit-backend` `0.1.0`, Python 3 for the bundled standard-library contract validator, and Git for managed lane/integration operations.

```bash
npm run prepare:local
npm run build
npm test
```

`prepare:local` is the pre-publication setup for two adjacent fresh checkouts
named `dsh-codex-kit` and `dsh-workflow-kit`. It runs the Codex workspace's
locked install, installs the matching adjacent backend into this checkout with
npm's `--no-save` mode, then builds backend → Codex. It does not rewrite either
repository's manifest or lock. Once `dsh-codex-kit-backend@0.1.0` is published,
a standalone workflow consumer can use ordinary `npm ci` instead.

The package ships its compiled Host entry, `cordis.patch.yml`, and `scripts/workflowctl.py`. Backend code changes require an explicit restart after running tasks are safely stopped; unloading Workflow does not close backend processes.

## Development

Prepare the dedicated profile once with the official `0.1.5-rc.1` `dsh` on PATH. If the profile does not exist, initialize the Web template, stop only that newly started host with Ctrl+C, then link the three checkouts in backend → UI → workflow order:

```bash
dsh --profile workflow-dev --from-default-profile web --no-open --port 0
dsh plugin --profile workflow-dev add \
  link:/absolute/path/to/dsh-codex-kit/packages/dsh-codex-kit-backend \
  link:/absolute/path/to/dsh-codex-kit/packages/dsh-codex-kit \
  link:/absolute/path/to/dsh-workflow-kit
```

After the one-time `npm run prepare:local`, one command owns the joint development
entry. It validates the effective profile and backend owner before writing any
artifact. A valid live Host uses both watchers with `--no-initial-build`; with no
owner it builds Codex then Workflow, waits for both watchers, and starts one
official Host on port `0`:

```bash
npm run dev -- --profile workflow-dev
```

If the profile's configured `stateDir` conflicts with another stage-5 run,
append one or more official rc.1 patch overlays in order:

```bash
npm run dev -- --profile workflow-dev \
  --patch /absolute/path/to/state-overlay.yml
```

Each `--patch` must name an existing file. The dev command resolves it to an
absolute path and forwards the repeatable pairs to its single PATH `dsh` Host.
The ordered overlays participate in the same owner/stateDir check. A reused Host
must already expose the backend Host, Codex, and Workflow HMR roots and remains
externally owned; dev cleanup never stops it.

The adjacent `../dsh-codex-kit` checkout is the default. Override it with `--codex-kit /absolute/path` or `DSH_CODEX_KIT_CHECKOUT`. Workflow changes build in staging and atomically replace only W `lib`; build failure, shutdown, or a backend core change leaves live output untouched. Ctrl+C waits for its two owned watchers and stops only a Host it started itself.
