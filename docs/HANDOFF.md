# Workflow kit handoff

Historical handoff. Use [README](../README.md) for current runtime boundaries and
[upgrade.md](../upgrade.md) for the proposed upgrade. The full worker UI described
below is not current workflow-kit scope.

Date: 2026-09-11 (Asia/Shanghai)

## Current product boundary

`dsh-workflow-kit` consumes only public `dsh-codex-kit-backend` APIs. The Host
owns worker/parent/private/link state, reports and acceptance, delivery, roles,
and managed workflow policy. Backend thread/turn/App Server lifecycle remains
backend-owned and survives workflow UI/tool reload.

The package includes the full visual worker client: header dock, New, Resume,
private/link/close groups, existing conversation transcript, model/skill input,
compact/review, approvals, report acknowledgement and acceptance, usage, and
right-sidebar navigation. Host tools can still run without a browser; the
browser client is not optional product scope.

The generated client factory is a Cordis plugin. Its `apply` registers
`conversation.session.header.utilities` and `sidebar.right.pane.tab`, and its
disposer removes only its own slot/tab registrations.

## Development and build contract

- Official DSH `0.1.5-rc.1` `dsh` must resolve on PATH.
- `npm run dev -- --profile workflow-dev` starts the adjacent Codex watch-only
  entry first. Its exact ready line follows backend then Codex UI build.
- Workflow is built next with its own installed esbuild, then its watcher
  starts. Dev reuses a live Host for the same profile and effective backend
  state, or starts exactly one PATH `dsh` Host on port `0` when none exists.
- Optional repeatable `--patch <absolute-file>` pairs are validated and
  forwarded in order to that Host for temporary state overlays. They do not
  change profile bundles or HMR, and cleanup does not stop an older Host.
- `--codex-kit` / `DSH_CODEX_KIT_CHECKOUT` select only the adjacent source
  checkout; they are not DSH executable overrides.
- SIGINT/SIGTERM signals the two watchers and only a Host created by this command;
  a reused external Host remains running.
  Backend source changes retain the documented restart-required behavior.

## Package boundary

The package exports `.` and `./client`, publishes `lib`, docs, scripts,
`cordis.patch.yml`, and the workflow contract validator. The manifest's web
client row and Host module patch both identify `dsh-workflow-kit`. The package
depends on `dsh-codex-kit-backend`, not the Codex browser/Host package.

The dependency is the published-version contract
`dsh-codex-kit-backend@0.1.0`; neither the manifest nor lock points at a source
checkout, temporary directory, or tarball. Before publication, local candidate
development uses `npm run prepare:local`, which performs the adjacent Codex
locked install, installs only its matching backend with npm `--no-save`, and
builds backend → Codex without changing that consumer contract.

## Stage 4 verification

On 2026-09-11, a clean combined source workspace with repository `lib`,
`node_modules`, Git metadata, and DSH state removed generated a standard lock,
ran `npm ci`, built backend → Codex → workflow, and passed the full workflow
suite (29 tests). The fixture pinned the complete DSH dependency set to
`0.1.5-rc.1` and used no peer-dependency bypass.

The documented `npm run prepare:local` was also run from fresh adjacent
no-`lib`, no-`node_modules` copies. It installed 78 Codex workspace packages
and 540 workflow packages, built backend then Codex, and left SHA-256 values for
both repositories' manifests and locks unchanged. The following workflow build
and full 30-test suite passed.

`npm run pack:check` packed backend, Codex, and workflow candidates, installed
all three with fixed rc.1 DSH and React peers, imported every public Host entry,
and materialized both browser factories. An earlier unpinned fixture selected
an rc.2 optional peer and failed; the checked fixture now rejects any such DSH
drift. The independently observed `workflow.test.mjs` failure was specifically
`spawnSync git EPERM` under restricted process permissions; the same full test
suite passed with normal child-process permissions.

## Stage 5 still required

Build, tests, factory materialization, and pack checks do not establish a real
browser or model run. The independent runner must verify the joint profile has
backend → Codex → workflow once, one Host/backend is created, the full worker UI
and visual Codex panel coexist, and no read-only action starts a model. Any real
smoke must explicitly use the requested minimal `gpt-6-luna` flow. Restart,
same-thread continuation, running UI/tool HMR, report/listener deduplication,
and owned-child cleanup remain runtime evidence tasks.
