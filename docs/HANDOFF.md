# Workflow kit handoff

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
- Workflow is built next with its own installed esbuild, then its watcher and
  exactly one PATH `dsh` Host start on port `0`.
- `--codex-kit` / `DSH_CODEX_KIT_CHECKOUT` select only the adjacent source
  checkout; they are not DSH executable overrides.
- SIGINT/SIGTERM signals only the two watchers and Host created by this command.
  Backend source changes retain the documented restart-required behavior.

## Package boundary

The package exports `.` and `./client`, publishes `lib`, docs, scripts,
`cordis.patch.yml`, and the workflow contract validator. The manifest's web
client row and Host module patch both identify `dsh-workflow-kit`. The package
depends on `dsh-codex-kit-backend`, not the Codex browser/Host package.

## Stage 5 still required

Build, tests, factory materialization, and pack checks do not establish a real
browser or model run. The independent runner must verify the joint profile has
backend → Codex → workflow once, one Host/backend is created, the full worker UI
and visual Codex panel coexist, and no read-only action starts a model. Any real
smoke must explicitly use the requested minimal `gpt-5.6-luna` flow. Restart,
same-thread continuation, running UI/tool HMR, report/listener deduplication,
and owned-child cleanup remain runtime evidence tasks.
