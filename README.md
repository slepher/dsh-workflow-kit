# dsh-workflow-kit

A DSH (DeepSeek Harness) plugin that owns workflow roles and profiles, task contracts, lanes, acceptance, integration and release, and delegates Codex execution to `dsh-codex-app-provider`.

English | [中文](README.zh-CN.md)

- [Overview](#overview)
- [Requirements](#requirements)
- [Install](#install)
- [Configuration and profiles](#configuration-and-profiles)
- [Strategies](#strategies)
- [Session gate and write grants](#session-gate-and-write-grants)
- [Tools and the client UI](#tools-and-the-client-ui)
- [Compatibility](#compatibility)
- [Development](#development)
- [Verifying the model-facing surface](#verifying-the-model-facing-surface)
- [Current validation status](#current-validation-status)
- [License](#license)
- [Related repositories](#related-repositories)

## Overview

`dsh-workflow-kit` is a Cordis plugin for DSH (package scope `@deepseek-ai/dsh-*`). It runs task-contract workflows: a plan is adopted as a generation, tasks are dispatched into git lanes, results are recorded and reviewed, candidates are integrated, and a release is prepared and completed. The plugin owns the orchestration state, the role catalogue, the write grants and the pre-execution gate that decide what a worker may do.

The package has two halves:

- **Host half** (`lib/index.js`) registers the `codex_workflow` tool, installs the workflow session gate, serves the browser profile channel, and persists workflow state (runs, lanes, native child bindings, Session selections).
- **Client half** (`./client`, bundled as `lib/client.js`) adds a configuration picker in the composer and the Workflow page in DSH settings.

Codex execution is not implemented here. Children are DSH-native subagent Sessions created through `ctx.subagents`, and the Codex provider supplies the execution engine, the native child facts and the `codexToolGate` capability (`src/workers.ts`, `src/types.ts`). The provider must be loaded before this plugin: the plugin injects `codexExecution` and `codexToolGate` (`src/host.ts:26`), and mounting it against a provider that publishes no gate fails with an explicit error instead of starting an ungated child (`src/host.ts:166`).

## Requirements

| Requirement | Value | Source |
| --- | --- | --- |
| Node.js | `>=22.19.0` | `engines.node` in `package.json` |
| Python 3 | `python3` on `PATH` | `src/workflow.ts:195` runs `python3 scripts/workflowctl.py` |
| Git | `git` on `PATH` | `src/workflow.ts:213` |
| `dsh-codex-app-provider` | `0.1.1`, loaded first | `peerDependencies` in `package.json` |
| DSH releases | `0.1.7-rc.2` and `0.2.0-rc.2` | `dsh.compatibility.dshReleases` in `package.json` |

Python 3 and Git are runtime requirements, not just build requirements: adopting a generation exports the plan and validating a recorded result both shell out to `scripts/workflowctl.py`, and lane creation and candidate diffs shell out to `git`.

## Install

### Develop in this checkout

1. **Build the provider first.** The provider is a runtime peer and the source of the types this package type-checks against. Build the adjacent checkout (`../dsh-codex-app-provider`, or whatever `DSH_CODEX_APP_PROVIDER_CHECKOUT` names):

   ```bash
   cd ../dsh-codex-app-provider && npm ci && npm run build
   ```

   It is deliberately **not** a `file:` devDependency here. A `file:` spec that leaves the package fails a git install outright — pnpm runs `npm install` inside the fetched copy, where no sibling checkout exists — and an adjacency it cannot resolve is worse than no adjacency at all. `scripts/stage-provider-types.mjs` copies the built result into this package's own `node_modules` instead, which is the only placement where the provider's `declare module "@deepseek-ai/cordis"` augmentation merges with this package's cordis instance; resolving the sibling directly by `paths` or symlink makes the augmentation land on the provider's own cordis copy and leaves `ctx.codexExecution` unknown.

2. **Prepare locked local dependencies.**

   ```bash
   npm run prepare:local
   ```

   `scripts/prepare-local.mjs` verifies that every `file:` devDependency ends in `.tgz` and exists, runs locked `npm ci --ignore-scripts`, and fails if `package.json` or `package-lock.json` changed; `scripts/stage-provider-types.mjs` then stages the provider's declarations. `npm ci` prunes the staged copy, so re-run this after any install.

3. **Build the plugin.**

   ```bash
   npm run build
   ```

   This generates the prompt skills (`src/prompts/*.md` → `src/generated/prompts.ts`), type-checks and emits the Host (`tsc -p tsconfig.json`), emits the client type declarations (`tsc -p tsconfig.client.json`), and bundles the client (`esbuild` → `lib/client.js`).

4. **Add the plugin to a Cordis profile** after the provider, and configure one workflow entry:

   ```yaml
   - id: dsh-workflow-kit
     name: dsh-workflow-kit
     config:
       stateDir: /absolute/isolated/state/workflow
       workflowSkillDir: /absolute/skills/codex-workflow
       implementationStandardDir: /absolute/skills/audit-implementation-simplicity
       defaultProfile: gpt-workflow
   ```

   The package's own bundle patch (`dsh.bundle.patch` → `cordis.patch.yml`) inserts the `dsh-workflow-kit` entry and carries `defaultProfile: gpt-workflow`, so a deployment that wants only the defaults supplies no `config` at all. A patch replaces a row's whole `config` value rather than merging keys, so a profile that restates the block states `defaultProfile` too.

### Install for users

`dsh plugin add` accepts a registry package, a packed tarball, or a git host. What arrives differs:

| Source | What arrives | Build on install |
| --- | --- | --- |
| npm — `dsh plugin add <package>` | `lib/` built at publish time | none |
| tarball — `dsh plugin add ./dsh-workflow-kit-0.1.1.tgz` | the same | none |
| git — `dsh plugin add github:slepher/dsh-workflow-kit#<sha>` | **sources only** | `prepare` |

A git install runs `prepare` (`scripts/prepare-build.mjs`), which transpiles the Host half and bundles the client **without a type checker**: the declarations this package's `types` field names are a development and publishing artifact and are not emitted on that path. It is self-contained — it reads nothing outside the fetched package — and pnpm ≥10 refuses to run it until the exact spec is allowed, so the first `add` fails and pnpm prints the line to copy into the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  "dsh-workflow-kit@git+https://github.com/slepher/dsh-workflow-kit.git#<sha>": true
```

Treat that allowance as permission to execute the package's code on the machine at install time, outside any sandbox: pin the commit. Install the provider first — bundle order is add order, and this plugin refuses to mount against a provider that publishes no `codexToolGate`.

Configuration fields (`src/host.ts:36`):

| Field | Meaning |
| --- | --- |
| `stateDir` | Absolute persistence root. It holds `orchestration.json` with runs, lanes, Session profile/strategy selections and native child bindings. When omitted, the launched profile's own state directory is used: `<profile home>/state/<profile name>/workflow`. Without a launched profile it falls back to `$DSH_HOME/state/default/workflow`, then to `~/.dsh/state/default/workflow`. A non-absolute `stateDir` is refused. |
| `workflowSkillDir` | Directory of the installed `codex-workflow` skill. Each role's protocol document is read from `<workflowSkillDir>/references/roles/<protocol>`. |
| `implementationStandardDir` | Directory of the installed implementation standard, read as `<implementationStandardDir>/SKILL.md`. When omitted it defaults to the sibling `audit-implementation-simplicity` skill next to `workflowSkillDir`. |
| `defaultProfile` | Deployment fallback for the configuration a new Session adopts. A stored `defaultConfig` selection wins over it. |

The remaining four entry fields — `defaultConfig`, `codingStrategy`, `integrateStrategy` and `configs` — are volatile settings that the plugin's own configuration form edits live, without remounting the plugin (`src/settings.ts:28`, `src/host.ts:70`).

## Configuration and profiles

Two catalogs are deliberately separate:

| Catalog | Members | Used by |
| --- | --- | --- |
| **Execution role catalog** | `planner`, `reviewer`, `context_collector`, `coding_worker`, `evidence_runner`, `full_tester` | What a contract may name as its `Role`, and what the dispatch tool can start. |
| **Configuration-key catalog** | `planner`, `reviewer`, `context_collector`, `def_coding_worker`, `sup_coding_worker`, `evidence_runner`, `full_tester` | What Profiles, stored overrides and the settings page edit. |

`def_coding_worker` and `sup_coding_worker` are model configurations for the single `coding_worker` execution role — not roles, and not permission levels. The keys stay stable so existing Profile files and stored overrides need no migration (`src/roles.ts:33`). A legacy contract or delegation that names them as a role is refused before it starts:

- at dispatch: `Legacy coding role <name> must be revised to Role: coding_worker before dispatch; the bound strategy selects the sup/def configuration` (`src/workflow.ts:253`);
- at delegation: the same refusal with `before delegation` (`src/workflow.ts:269`).

Already-created children keep the configuration recorded when they were created.

**Three-layer key resolution.** Each configuration key resolves through, in order: the **stored user override**, then the **shipped configuration**, then the **shipped key default** (`src/configuration.ts:147`). Stored overrides are sparse, so editing one key leaves the others inherited; clearing a configuration's stored section reverts it whole. A stored configuration whose id matches a shipped one overrides it; any other id is a user-authored configuration.

Shipped profiles (package content, not user configuration):

| Profile | Provider | Roles |
| --- | --- | --- |
| `gpt-workflow` (`profiles/gpt-workflow.json`) | `codex` | `planner` = `gpt-6-astra` (high); `reviewer` = `gpt-6.1-sol` (high); `context_collector` = `gpt-6-luna` (high); `def_coding_worker` = `gpt-6-luna` (medium); `sup_coding_worker` = `gpt-6.1-sol` (medium); `evidence_runner` = `gpt-6-luna` (medium); `full_tester` = `gpt-6-luna` (medium). |
| `ds-workflow` (`profiles/ds-workflow.json`) | `deepseek-official` | every key is `deepseek-flash`, at `max` effort for `planner`, `reviewer` and `context_collector`, and `high` for the coding, evidence and tester keys. |

These shipped key defaults are also what an unknown or missing configuration falls back to (`src/roles.ts:44`). The older `gpt-6-sol` id is no longer a shipped default anywhere; a deployment that still wants it must state it explicitly in its own Profile or stored override.

**Settings page and composer picker.** The Workflow settings page (`settings.section`, id `workflow`) edits the stored layer as path mutations: per-key provider/model/effort editors, plus copy, rename, delete, reset and set-default actions. Built-in configurations are editable in place through sparse overrides and can be reset whole; a copy is an ordinary user configuration that can be renamed or deleted. The `manager` row is listed but not editable — the manager runs on the composer's model. The composer picker (`conversation.input.left`, id `workflow-config`) only *selects* a configuration and a Session coding strategy; it re-reads the catalog whenever it opens, and both chips are hidden in a subagent Session, whose profile and strategy were already fixed by the delegation that started it.

## Strategies

A strategy is not a permission level. It decides which Profile model configuration a coding execution runs on, whether that execution may hand off or ask for bounded expert consultation, and which phase prompt the Host binds. The execution role stays `coding_worker` throughout.

Four strategies are selectable — `economy`, `adaptive`, `bootstrap`, `expert` (`src/constants.ts:27`). The stored coding default is `adaptive`; the stored integrate default is `economy`. Both are written to separate settings paths, so one change never rewrites the other. Coding has a per-Session override in the composer; integration has no Session scope and always uses the stored integrate setting (`src/store.ts:48`, `src/profile-rpc.ts:108`).

| Requested strategy | Phase | Model configuration | Handoff | Consultation | Bound phase prompt |
| --- | --- | --- | --- | --- | --- |
| `economy` | main | `def_coding_worker` | no | no | `coding-independent` |
| `expert` | main | `sup_coding_worker` | no | no | `coding-independent` |
| `adaptive` | main | `def_coding_worker` | no | yes | `coding-adaptive` |
| `bootstrap` | opening | `sup_coding_worker` | yes | no | `coding-bootstrap-opening` |
| `bootstrap` | continuation | `def_coding_worker` | no | yes | `coding-bootstrap-continuation`, `coding-adaptive` |
| any | consultation | `sup_coding_worker` | no | no | `coding-consultation` |

(source: `bindCodingStrategy`, `src/strategy.ts:69`)

**Derived `independent`.** When a Profile's `sup_coding_worker` and `def_coding_worker` resolve to the same provider and model, both selectable strategies are inert: the effective strategy is `independent`, def runs the whole assignment, no handoff or consultation is authorized, and the composer hides the strategy control. Effort is deliberately ignored in that comparison, and the stored preference is retained so it takes effect again under a Profile with different models (`src/strategy.ts:31`, `src/client/ConfigPicker.tsx:122`). This is a configuration-derived behaviour, not a fifth selectable strategy.

**Binding.** Each coding dispatch and each integration records its effective strategy and the sup/def Profile snapshot it was bound to, so later Profile or settings edits never rewrite a running execution or a prepared integration; a refreshed integration binds the settings in force when it is prepared (`src/configuration.ts:199`). Integration review and repair keep their own roles and permissions — a reviewer stays read-only and a repair `coding_worker` keeps its write scope — while the integrate strategy selects the model configuration (`src/workflow.ts:400`).

**Delegation is the exception.** An ordinary `delegate` child has no attempt and no generation, so the Host cannot advance a handoff or deliver a consultation report for it: a delegated coding child always runs the def configuration independently, regardless of the Session's coding strategy (`src/workflow.ts:270`).

## Session gate and write grants

Every child the Host starts is bound before it starts to `{ role, hook, args }`, and that binding is stored with its record (`src/gate.ts:198`). `role` is this plugin's own business label; the provider never enumerates or interprets it. All rules live in one deterministic function, `workflowGateHandler`, and neither entry point calls a model (`src/gate.ts:359`):

- **DSH native path.** One global `ctx.tools.guard()` answers only for a Session this Host registered — a managed child's stored binding, or the manager's binding derived from the run it adopted — so a denial happens before the tool body (`src/host.ts:106`, `src/host.ts:168`).
- **Codex path.** The same function is registered under the provider's `codexToolGate` capability as the `workflow.preToolUse` hook; the provider forwards every PreToolUse call to it (`src/host.ts:165`, `src/gate.ts:21`).

What is refused:

- A **manager** is refused the known shell entry points (`bash`, `pwsh`, `Bash`, `exec_command`, `shell`, `shell_command`, `write_stdin`) and may write only its generation's `summary.md` plus whatever auxiliary grants an assignment named. A registered child may run a shell: the gate does not read a program's file effects, and the existing sandbox still applies.
- Every registered Session is refused the scheduling entry points: `subagent`, `subagent_fork`, `workflow`, `ralph`, `spawn_teammate`, `wait_agent`, `team_task_create`, `team_task_list`, `team_task_get`, `team_task_update`, `send_message`, `interrupt_agent`, `codex_workers`, and the Codex `spawn_agent`, `Agent`, `resume_agent`, `close_agent`. Read-only queries (`list_agents`, `list_subagent_models`, `job_*`) stay available.
- Known file writes are matched against the assignment's own grants (`write`/`edit` via `file_path`; `str_replace_editor` via `path`, where `view` is a read and only `create`/`str_replace`/`insert` write; Codex `apply_patch` against every Add/Update/Delete/Move directive, the whole patch refused if any one path is unauthorized). A coding assignment owns its task's `Owned paths` one by one — never a whole lane — plus its declared `Write` paths, its concrete report paths and its artifacts. A review, a consultation, an integration repair and a non-coding task own only what they were assigned. Paths are checked both lexically and after symlink resolution, and product grants are additionally confined to the lane.
- A file write whose Session cwd is missing is refused rather than resolved against the server's launch directory. The operation's own reported cwd resolves a relative path; it does not have to equal the assignment's cwd, because the assignment states which paths may be written, not where the caller stands.

Deliberately **not** covered, and not claimed: file effects inside a shell program, MCP tools registered as `mcp__<server>__<name>`, and `cordis_define`/`cordis_run`, which can register and run arbitrary code at runtime. Unknown tools are left to the rest of the pipeline.

A denial always starts with `workflow gate: `, so it is machine-recognizable in a session log (`src/gate.ts:31`). A refusal names both the path that was refused and the paths the assignment did authorize (a directory grant carries a trailing separator), so a worker that resolved a relative path against the wrong directory can correct itself. A Session with no binding — an ordinary delegation, or a legacy record written before the gate existed — is untouched.

**Native child workspace nuance.** DSH has no way to place a child in another directory: the stock subagent runtime copies the parent's workspace into the child Session header, so a DSH-native child resolves relative paths against the repository. A Codex child's thread is started in the assigned directory, so relative paths there resolve into the lane. The prompts therefore state where the child really runs, and a native child is told to run every command with the assigned directory as that command's working directory (`workdir`, or `cd` first) — otherwise it would write into its lane and then test the repository, a failure the gate cannot catch because the command succeeds on the wrong tree (`src/workflow.ts:299`).

**Lanes.** Every worktree a run creates goes under `<repository>/agentwork/.lanes/lane-NN` (names are zero-padded, e.g. `lane-01`), so a finished goal leaves no worktree inside its own directory to clean up and the next goal in that repository reuses the ones already there (`src/workflow.ts:40`, `src/workflow.ts:1015`). The Host enforces the plan's declared concurrency and lane capacity, live ownership of an assigned path, and a task's declared workspace when it names no lane (`src/workflow.ts:327`, `src/workflow.ts:998`).

## Tools and the client UI

The Host registers exactly one model-facing tool, `codex_workflow` (`src/host.ts:170`). Its `action` parameter accepts:

| Action | Kind | Purpose |
| --- | --- | --- |
| `roles` | read | List the execution role catalogue with each role's provider, model, effort and whether it implements. |
| `status` | read | Report the adopted generation, its tasks, lanes, workers and pending work. |
| `adopt` | write | Adopt an absolute `<repository>/agentwork/<goal>/generation-N` directory. |
| `dispatch` | write | Start a task's attempt, optionally naming `lane` and `base`. |
| `record-result` | write | Record the retained report file (`result`, absolute) holding a task result. |
| `accept` | write | Accept a recorded result. |
| `integrate` | write | Prepare or advance an integration of accepted candidates. |
| `resolve` | write | Resolve an integration conflict under a reviewer decision. |
| `resolved` | write | Record the resolution outcome. |
| `refresh-integration` | write | Re-bind an integration to the settings and snapshot in force now. |
| `continue` | write | Send a correction to a task's worker or to a named worker. |
| `archive` | write | Archive a stopped attempt without delivering its candidate. |
| `release` | write | Release a task's lane and ownership after work is settled. |
| `complete` | check | Check only: every executable task must have delivered and released evidence and no lane or child may still be open. It performs no Git operation and refuses with the outstanding disposition. |
| `delegate` | write | Assign one bounded task to a role without adopting a generation; pass `role` and `text`. With `child` it continues or steers an existing child, and with `stop: true` it stops the current turn. |

The tool also takes `generation`, `task`, `attempt`, `lane`, `base`, `result`, `text`, `recipient`, `processesStopped`, `role`, `child`, `stop`, `cwd`, `name`, `writes` and `network` (`src/host.ts:175`). `delegate` answers before its child has worked: every result carries the child handle plus `reply`, or `reply: null` with the reason there is none, and a child that has not settled yet announces itself through the runtime's own settlement notice on a later turn. `codex_workers` tracks its own workers and cannot read a child started here (`src/host.ts:174`).

The client half registers:

- a **composer configuration picker** in `conversation.input.left`, whose chips select the Session's workflow configuration and coding strategy;
- the **Workflow settings page** in `settings.section` (id `workflow`), with a **Strategy** tab holding the two independent strategy defaults and a **Configurations** tab holding the per-key editors, described above (`src/client/index.ts:49`, `src/client/index.ts:60`).

## Compatibility

`package.json` declares the DSH releases this build is checked against:

```json
"dsh": { "compatibility": { "dshReleases": { "0.1.7-rc.2": "compatible", "0.2.0-rc.2": "compatible" } } }
```

Every DSH Host package is an **optional `*` peer dependency** (`peerDependencies` plus `peerDependenciesMeta`), so one build can load on each listed release; `dsh-codex-app-provider` is the exception — an optional peer pinned to `0.1.1`. The checked-in `devDependencies` pin the single generation used for type checking and tests (`0.1.7-rc.2`).

An isolated install brings its own Host generation: `scripts/pack-check.mjs` requires the `@deepseek-ai/dsh-*` devDependency specs to name exactly one generation, installs `@deepseek-ai/dsh@<that generation>` together with the freshly packed provider and (for the workflow combination) this package, and overrides `dsh-codex-app-provider` to the packed tarball.

## Development

All commands run from the repository root.

| Command | What it does |
| --- | --- |
| `npm run build` | Generates prompt skills, compiles the Host (`tsconfig.json`), emits client declarations (`tsconfig.client.json`), and bundles the client with esbuild into `lib/client.js`. |
| `npm test` | Runs `node --test test/*.test.mjs` (26 test files). Tests import the compiled `lib/*`, so run `npm run build` first. |
| `npm run prepare:local` | Verifies local `file:` tarballs exist and runs locked `npm ci` without modifying the manifests. |
| `npm run pack:check` | Packs this package and the provider in a temporary directory, installs provider-only and provider+workflow combinations at the pinned Host generation, and mounts the real Cordis runtime without calling a model or a browser. It retains the temporary directory and prints its path. The provider checkout is `../dsh-codex-app-provider` unless `DSH_CODEX_APP_PROVIDER_CHECKOUT` names another one. |
| `npm run dev` | Linux only. `--profile <name>` (default `workflow-dev`), `--app-provider <checkout>` (or `DSH_CODEX_APP_PROVIDER_CHECKOUT`), and repeatable `--patch <file>` overlays. Requires the profile to load `dsh-codex-app-provider` then `dsh-workflow-kit`, an absolute provider `stateDir`, and HMR roots covering both checkouts' `lib`. It builds both checkouts, starts both watchers, and either starts one `dsh` Host on port 0 or reuses a live same-profile Host (`/proc`-based owner inspection). A reused Host is left running on exit. |
| `npm run dev:host` | Starts or checks a dev Host without the long-lived watchers. `--profile` (default `workflow-kit-dev`), `--port` (default `3080`), `--check` to verify only. |
| `npm run publish` | Builds in a staging directory and replaces `lib/` in one rename, so a watching Host never sees a half-written bundle. |
| `npm run publish:watch` | Same, republishing on every change under `src/`. |

**Watched-publish behaviour.** `scripts/watch.mjs` (used by `npm run dev`) builds in `.watch/publish-build` and atomically replaces `lib/`. It also watches the provider's `src/`: any provider source change pauses publication until the Host is restarted. `npm run publish:watch` publishes complete staged builds the same way, driven only by this package's `src/`.

Design records for the strategy and prompt wiring live in [upgrade.md](upgrade.md) and [docs/upgrade-prompts.md](docs/upgrade-prompts.md).

## Verifying the model-facing surface

The test suite covers the behaviour behind the tool — planning, delegation boundaries, strategies, storage, and the Host's routing. It cannot cover the tool's *model-facing* surface: the action set, the parameter semantics, and the error wording an agent actually reads. Those only fail inside a real conversation.

**Required whenever the tool's description, its parameters, its error text, or its action set changes.**

The transport is scripted; the judgement is not:

1. Drive a real conversation with the script:

   ```bash
   DSH_TOKEN=<token from the `dsh web:` line> node scripts/dialog-check.mjs "<prompt>"
   ```

   `scripts/dialog-check.mjs` authenticates against the running `dsh web` origin, creates a fresh Session, sends one ordinary user prompt, waits for the turn to settle, and prints the driving Session's transcript plus any Session the run created. It asserts nothing. `DSH_BASE`, `DSH_CWD`, `DSH_HOME` and `DSH_TIMEOUT_MS` override its defaults.
2. Use a user-level goal with no parameter hints, so the run measures what an agent can work out from the tool description alone.
3. Read the printed transcript and judge the **reply**, not whether the call returned.

Checklist for the delegation path:

1. Start a child with `codex_workflow { action: "delegate", role: "evidence_runner", text: "<a greeting>" }`. `evidence_runner` edits no source, so the pass stays cheap. The result must carry `reply: null` with a note saying where the reply will arrive; a bare handle is the defect that field replaced.
2. Confirm **one** notice settles the child, and that it is the runtime's own — the workflow plugin contributes none. It names the child and carries its closing message, or states that the child left none.
3. Confirm the caller neither polls, sleeps, nor spends a second call waiting for the reply: it ends its turn, and the notice carries the reply into the next one. Re-reading a settled child with `{ action: "delegate", child: "<handle>" }` still returns `reply` from the durable report.
4. Send a second turn on the *same* child with the returned handle — `{ action: "delegate", child: "<handle>", text: "<a follow-up>" }` — and confirm the reply continues that conversation instead of starting another.
5. Confirm the caller never reaches for `codex_workers` with that handle: it tracks its own workers, so its `get` refuses and its `reports` returns an empty list.
6. Stop the current turn with `{ action: "delegate", child: "<handle>", stop: true }` and confirm the returned child state changes.
7. Confirm that none of the above demands `adopt` or a `generation`: delegation is the generation-free path.

A defect such as reading `task` where `text` is required, or an error that does not name the field to pass, is visible only in the transcript.

## Current validation status

- `npm test` runs 26 test files covering configuration merging, role resolution, strategies, the gate, delegation, dispatch, handoff, storage, profile RPC, the client bundle and the dev/pack scripts. They exercise the compiled Host against a fake in-process provider and stub Host services, and do not call a model.
- `npm run pack:check` performs an isolated Node/Cordis install check of the provider-only and provider+workflow combinations and prints `no model or browser` in its pass line.
- Real-model validation — live dispatch, cross-provider successor continuation and the browser checks — is not part of the committed automated suite. The strategy design record [upgrade.md](upgrade.md) states that its target behaviour does not represent a validation result.
- This repository ships no `evidence/` directory; earlier claims about recorded `evidence/*.json` runs are not verifiable here and are not repeated.

## License

MIT (`license` in `package.json`).

## Related repositories

- **`dsh-codex-app-provider`** — the sibling DSH plugin that provides the Codex execution engine, the read-only `codexExecution` facts and the `codexToolGate` capability this plugin binds. It must be loaded before `dsh-workflow-kit`. It is declared as an optional peer dependency, not bundled or shipped by this package, and this README does not link to it.
