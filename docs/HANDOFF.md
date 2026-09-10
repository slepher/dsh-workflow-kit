# Workflow kit handoff

Date: 2026-09-10 (Asia/Shanghai)

## Repository and scope

Repository: `/home/slepher/project/agents/dsh/dsh-workflow-kit`

This repository is a new, independent Git repository for `dsh-workflow-kit`. All files are currently untracked because the task does not authorize a commit, push, publish, or remote creation. The old `dsh-subagents-codex` product, services, profiles, state, and workers were not changed. The sibling `dsh-codex-kit` implementation is owned by `/root/implementation`; this repository only consumes its public backend package.

## Implemented state

- `src/workers.ts`, `src/store.ts`, `src/controller.ts`, and `src/delivery.ts` implement ordinary persistent worker create/list/get/roles, append, steer, interrupt, resume, configure, approvals, reports, acknowledgement, acceptance, close, busy step-boundary delivery, idle follow-up, restart reconciliation, durable backend event cursors, and idempotent terminal reports.
- The workflow owner namespace is separate from the user UI owner. A global backend mutation guard blocks ordinary mutations of managed workers and creation whose normalized cwd or writable roots overlap an occupied managed lane. Managed interrupt/resume/configure/close/accept also require the workflow path.
- `src/workflow.ts` and bundled `scripts/workflowctl.py` implement managed generations, attempts, capacity, worktree lanes, candidate/result validation, independent review, integration/conflict resolution, delivery, archive, and release.
- `src/roles.ts` defines the seven supplied worker roles and resolves installed role protocol files through configured paths; no machine-specific private path is embedded in the package default.
- `src/host.ts` is a headless DSH plugin. It injects `codexKit`, uses only `ctx.codexKit.backend`, registers `codex_workers` and `codex_workflow`, and removes its subscriptions/guard on unload without closing the shared backend.
- `scripts/dev.mjs` builds workflow, starts the adjacent Codex watch-only entry, waits for exact stdout `dsh-codex-kit watch ready`, starts the workflow watcher, then starts exactly one host on port `0` with `dsh` from PATH. Before starting, it verifies the profile contains backend → UI → workflow exactly once. It stops only its own children on SIGINT/SIGTERM.
- The workflow client build now reuses the adjacent Codex checkout's installed esbuild and emits one rc.1 `window.__ModuleLoader__.load` closure registered as `dsh-workflow-kit`. `scripts/watch.mjs` serially reruns the same build after workflow source changes, so client HMR never receives the former plain ESM artifact. No dependency or HMR/profile row was added.
- `package.json` and `package-lock.json` use DSH `0.1.5-rc.1`; no alpha cutoff or patched CLI requirement remains. README and `docs/development.md` use the official rc.1 `dsh` on PATH.

## Last completed validation

The last full verification completed after the rc.1 migration and global guard boundary update:

- `node --check` for `scripts/dev.mjs`, `build-client.mjs`, and `watch.mjs`: exit 0.
- `npm run build`: exit 0.
- `npm test`: 8 passed, 0 failed, about 0.50 seconds.
- Tests cover the built client's exact single loader registration in addition to delivery, Host registration, reconciliation, guards, uncertainty, and managed Git flow.
- `npm pack --dry-run`: exit 0, 54 files, about 47.9 kB packed; includes the closure client, compiled Host entries, docs, `cordis.patch.yml`, build/watch/dev scripts, and validator.
- Fresh workflow/backend tarballs installed together under `/tmp/dsh-workflow-path-8dIEZH`: exit 0; public root import and `dsh-workflow-kit/client` loader registration checks exited 0.
- `git diff --check`: exit 0.
- PATH resolves `dsh` to `/home/slepher/.nvm/versions/node/v24.13.1/bin/dsh`; `dsh --version` reports `0.1.5-rc.1`.
- Installed direct DSH packages (`dsh`, `dsh-agent`, `dsh-llm`, `dsh-tools`, and optional peer `dsh-system-prompt`) were read back as `0.1.5-rc.1`.
- The initial sandboxed build, pack, and watcher rebuild attempts failed with `EROFS`, and the sandboxed Git integration test failed with `spawnSync git EPERM`; rerunning the same commands with the assigned sibling-repository/Git permissions produced the passing results above. The first closure build also exposed and retained an `import.meta` warning because the client imported the aggregate Host entry; moving the shared plugin ID to the browser-safe `constants` module removed that Host graph and the final build is warning-free.

## Development profile state

The dedicated profile exists at `/home/slepher/.dsh/profiles/workflow-dev`. It was first created using the global rc.1 executable and the Web template, and that one initialization host was stopped with Ctrl+C (exit 130). The profile links are linked in backend → UI → workflow order:

- `/home/slepher/project/agents/dsh/dsh-codex-kit/packages/dsh-codex-kit-backend`
- `/home/slepher/project/agents/dsh/dsh-codex-kit/packages/dsh-codex-kit`
- `/home/slepher/project/agents/dsh/dsh-workflow-kit`

The profile bundle order was inspected as base, Web, backend, UI, workflow with one backend row. Its patch config sets separate backend/workflow state directories below the new profile, configured workflow/implementation skill directories, and HMR roots for Codex UI and workflow `lib` only; backend output is excluded because backend changes require restart.

The profile manifest was rechecked read-only: its bundles remain base, Web, backend, UI, workflow; each kit bundle occurs once. Its HMR roots contain only Codex UI and workflow `lib`, with backend excluded. Final runtime consistency remains for the combined evidence runner to establish.

No workflow dev watcher, Codex watcher, DSH host, backend process, or test command started by this worker remains running. The full joint dev command has not been started against the PATH rc.1 CLI.

## Open validation and dependencies

1. The Codex owner must finish its remaining rc.1 UI/RPC behavior and confirm the adjacent watch-only entry still builds and prints `dsh-codex-kit watch ready`.
2. Before starting, the combined evidence runner must verify the PATH `dsh`, built-in base/Web bundles, both linked Codex packages, and this workflow package all resolve to rc.1.
3. Run from this repository:

   `npm run dev -- --profile workflow-dev`

   Wait for the Codex readiness line, workflow watcher readiness, and one DSH host URL. Do not print or save its authentication token. Stop with Ctrl+C and verify only the three child processes exit. Do not touch old/global services.
4. Run the final cross-repository acceptance selected by the parent after Codex is ready. Any real model smoke must explicitly select `gpt-5.6-luna` with medium effort; the product default remains cwd-configured and must not be hard-coded to Luna.
5. Re-run build, 8 tests, pack dry-run, diff check, and package/version inspection after any integration fix.

No additional backend API is currently requested. The final public API used here includes global `installGuard`, normalized `BackendMutation.boundary`, durable sequenced events, terminal `finalOutput`, typed execution policy, and the shared `CodexKitService` host context.

## Known non-acceptance and failed attempts

- Final rc.1 single-host joint dev startup/shutdown is not yet validated.
- The earlier joint browser run failed because the workflow client was plain ESM. The package-level closure defect is fixed and isolated execution passes; a fresh joint browser run remains required to close the retained runtime failure.
- Final UI/session behavior and any real Luna worker smoke belong to the combined acceptance and are not established by this repository's mock backend tests.
- The optional browser workflow UI was not implemented; the requested headless workflow operation is implemented.
- An optional state-size edit that would have stripped all persisted `text` fields was rejected by automatic approval review as a data-loss risk and was not applied. The safe full state plus immutable snapshot representation remains.
- One intermediate documentation patch failed its context check after wording had already changed; it made no edit, and the corrected patch was applied afterward.
- No publish, push, commit, release, old-state migration, or old-service operation was attempted.

## Evidence and authoritative files

- Execution document: `/home/slepher/project/agents/dsh/dsh-subagents-codex/docs/split.md`
- Workflow/backend/old test evidence: `/tmp/dsh-split-workflow-source.txt`
- Validator/prompts/role evidence: `/tmp/dsh-split-workflow-extra.txt`
- Joint dev/profile CLI evidence: `/tmp/dsh-split-dev-source.txt`
- HMR config evidence: `/tmp/dsh-split-hmr-source.txt`
- Earlier mixed-profile version evidence: `/tmp/dsh-split-profile-version-evidence.txt`
- Supplemental backend evidence: `/tmp/dsh-split-backend-source.txt`
- Current backend public contract: `/home/slepher/project/agents/dsh/dsh-codex-kit/packages/dsh-codex-kit-backend/src/browser-types.ts`
- Workflow role protocol read for this implementation: `/home/slepher/.codex/skills/codex-workflow/references/roles/sup-coding-worker.md`

Treat `/tmp` evidence as session-local. If it is absent in the next window, obtain fresh read-only evidence through the assigned evidence runner rather than exploring the old repository or network from the implementation worker.
