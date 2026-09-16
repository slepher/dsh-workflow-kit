# dsh-workflow-kit

> 当前用户需求：[plugin-requirements.md](../plugin-requirements.md)。
> 下文旧阶段的协调 DSH 包、角色指令透传与强制只读声明按统一基线修订。

This README retains project and implementation notes. [upgrade.md](upgrade.md)
and [upgrade prompts](docs/upgrade-prompts.md) record the strategy design and prompt
wiring; the unified requirements above govern current work. The older architecture,
HANDOFF and NEXT-STEPS documents are historical and do not define current UI scope.

Workflow owns role/profile files, native Session profile selections, task contracts, lanes, acceptance, integration and release. Codex execution runs through DSH native children and the single `dsh-codex-app-provider` Host plugin. The same package provides a `./client` half: a configuration picker in the composer and the Workflow page in DSH settings.

## Runtime configuration

Load `dsh-codex-app-provider` before this package. Configure one workflow entry:

```yaml
- id: dsh-workflow-kit
  config:
    stateDir: /absolute/isolated/state/workflow
    workflowSkillDir: /absolute/skills/codex-workflow
    implementationStandardDir: /absolute/skills/audit-implementation-simplicity
    defaultProfile: gpt-workflow
```

`stateDir` contains workflow records, acceptance and native child creation snapshots. Native Session/thread execution state and terminal report contents remain execution-owned. Existing legacy data is retained. `workflowSkillDir` identifies the installed task-contract tooling and role protocols; `implementationStandardDir` defaults to the sibling `audit-implementation-simplicity` skill.

## Configurations

The two configurations this package ships are plugin content: `profiles/gpt-workflow.json` (`codex` provider) and `profiles/ds-workflow.json` (`deepseek-official/deepseek-flash`, with the codex `high`/`medium` effort split translated to `max`/`high`). Each maps the fixed configuration-key catalog to explicit `provider`, `model` and `reasoningEffort` values. Role developer instructions are composed at run time from `lib/generated/prompts.ts` and the deployment's installed skill layout; nothing is installed into DSH home, and per-deployment state lives only in the `dsh-workflow-kit` settings namespace.

The Host resolves each key through three layers: the stored user override, the shipped configuration, then the shipped key default. Stored overrides are sparse, so editing one key leaves the others inherited, and clearing a configuration's stored section reverts it whole. A stored configuration whose id matches a shipped one overrides it; any other id is a user-authored configuration. The Workflow settings page writes those overrides as path mutations, and the composer picker only selects.

Two catalogs are deliberately separate. The **execution role catalog** (`planner`, `reviewer`, `context_collector`, `coding_worker`, `evidence_runner`, `full_tester`) is what a contract may name as `Role` and what the dispatch tool can start. The **configuration-key catalog** (`planner`, `reviewer`, `context_collector`, `def_coding_worker`, `sup_coding_worker`, `evidence_runner`, `full_tester`) is what Profiles, stored overrides and the settings page edit; the two legacy coding keys stay stable so existing model configuration needs no migration. `def_coding_worker` and `sup_coding_worker` are model configurations for the one `coding_worker` role, not roles or permission levels; a legacy contract naming them is refused at dispatch with an explicit revision message, while already-created children keep their recorded configuration.

## Strategies

Settings → Workflow opens a **Strategy** tab beside the configuration editors. It stores two independent defaults: `codingStrategy` (default `adaptive`, overridable per Session from the composer) and `integrateStrategy` (default `economy`, no Session scope, never inherited from the coding choice). Both are written as separate settings paths, so one change never rewrites the other.

The bound strategy decides which coding configuration runs, which phase prompt the Host binds, and whether the execution may hand off or request bounded consultation: `economy` and `expert` run independently on def and sup, `adaptive` runs def with bounded consultation, and `bootstrap` opens on sup and continues on def. Effort differences do not count: when a Profile's sup and def resolve to the same provider and model, the effective strategy is the derived `independent`, the composer hides the strategy control, and def runs the whole assignment. That is a configuration-derived behaviour, not a fifth selectable strategy, and the stored preference is retained for a Profile with different models.

Each coding dispatch and each integration records its effective strategy plus the sup/def Profile snapshot it was bound to. Later Profile or settings edits therefore never rewrite a running execution or a prepared integration; a refreshed integration binds the settings in force when it is prepared. Integration review and repair keep their own roles and permissions (a reviewer stays read-only, a repair `coding_worker` keeps its write scope) while the integrate strategy selects the model configuration, and ordinary task review keeps the reviewer configuration.

## Session gate

Every child this Host starts is bound before it starts to `{ role, hook, args }` and that binding is stored with its record. `role` is this plugin's own business label — the provider never enumerates or interprets it. The rules live in one deterministic function (`src/gate.ts`); both entry points call it, and neither calls a model:

- the **DSH native** path installs one global `ctx.tools.guard()` that answers only for a Session this Host registered (a managed child's stored binding, or the manager's binding derived from the run it adopted), so a denial happens before the tool body;
- the **Codex** path registers the same function with `ctx.codexToolGate`, and the provider carries every PreToolUse hook call to it over the socket its hook command talks to. See the provider README for the deployment prerequisite.

What is checked:

- A **manager** is refused the known shell entry points (`bash`, `pwsh`, `Bash`, `exec_command`, `shell`, `shell_command`, `write_stdin`) and may write only its generation's `summary.md` (plus whatever auxiliary grants an assignment named). A **registered child** may run a shell: this gate does not read a program's file effects, and the existing sandbox still applies.
- Every registered Session is refused the scheduling entry points — `subagent`, `subagent_fork`, `workflow`, `ralph`, `spawn_teammate`, `wait_agent`, `team_task_*`, `send_message`, `interrupt_agent`, `codex_workers`, and the Codex `spawn_agent`/`Agent`/`resume_agent`/`close_agent`. Read-only queries (`list_agents`, `list_subagent_models`, `job_*`) stay available.
- Known file writes are matched against the assignment's own grants: `write`/`edit` (`file_path`), `str_replace_editor` (`path`; `view` is a read), and Codex `apply_patch` (every Add/Update/Delete/Move path, the whole patch refused if any one path is not authorized). A coding assignment owns its task's `Owned paths` one by one — never a whole lane — plus its declared Write paths, its concrete report paths and its artifacts. A review, a consultation, an integration repair and a non-coding task own only what they were assigned. Paths are checked both lexically and after symlink resolution, and product grants are additionally confined to the lane.
- A file write whose Session cwd is missing is refused rather than resolved against the server's launch directory, and a cwd that is not the assignment's is refused rather than rewritten.

Deliberately **not** covered, and not claimed: file effects inside a shell program, MCP tools registered as `mcp__<server>__<name>`, and `cordis_define`/`cordis_run`, which can register and run arbitrary code at runtime. Unknown tools are left to the rest of the pipeline.

A denial always starts with `workflow gate: `, so it is machine-recognizable in a session log. A Session with no binding — an ordinary delegation, a legacy record written before the gate existed — is untouched.

A file write is resolved against the directory the operation itself reports, and the resolved path — lexically and after symlink resolution — must fall inside one of the assignment's grants. The assignment does **not** have to be the directory the caller stands in: it states which paths may be written, not where the writer is. So a worker in a lane may write `worktree/lane1/src/test.ts` relative to the repository root, or the same file by its absolute path; both resolve inside the lane's grant. What is refused is a path that resolves outside every grant — including one written as if the lane were the working directory, such as a bare `src/test.ts` from the repository root, which lands in `<repository>/src/test.ts`.

That last case is the one place where a **DSH-native** child differs from a Codex child. DSH has no way to place a child in another directory: the stock subagent runtime copies the parent's workspace into the child Session header, so a native child's tools resolve relative paths against the repository. A Codex child's thread is started in the assigned directory, so relative paths there resolve into the lane. The prompts therefore state where the child really runs. A Codex child is told its task and command cwd is the assigned directory. A native child is told its Session workspace as well, and — because a workspace resolves a build, a test or a `git` call just as much as it resolves a filename — it is told to run every command with the assigned directory as that command's working directory (`workdir`, or `cd` first). Without that, a native lane worker would write into its lane and then test the repository, which is the failure mode a denial cannot catch: the command succeeds, on the wrong tree. The same note is appended to a review prompt and to an integration repair, which run in the integration worktree rather than in the Session workspace. A missing Session workspace refuses the file write rather than falling back to the server's launch directory.

A refusal is written to be acted on, not just obeyed: it names the path that was refused **and** the paths the assignment did authorize (a directory grant carries a trailing separator). A worker that resolved a relative path against the wrong directory can read the granted paths off the denial and correct itself without another round trip to the manager. A worker also writes the documents it was told to produce outside its lane — its declared report paths and its artifacts directory are granted as auxiliary writes, while an unassigned neighbour in that same results directory is not.

## Build and validation

Requires Node >=22.19, Python 3, Git, `dsh-codex-app-provider` 0.1.0 and a coordinated DSH package set containing the native execution interfaces. The checked-in dependency locks identify local tarballs built from DSH 0.1.5-rc.1 source with changes; registry rc.1 alone does not implement those interfaces.

Build and pack the provider and coordinated DSH dependencies first, then:

```bash
npm run prepare:local
npm run build
node --test --test-isolation=none test/install-configuration.test.mjs test/prepare-local.test.mjs test/profile-rpc.test.mjs test/host.test.mjs test/native-workers.test.mjs test/backend-consumer.test.mjs test/workflow.test.mjs test/configuration.test.mjs test/store.test.mjs
```

`prepare:local` checks local tarballs before running locked `npm ci`; it does not build or modify another checkout. The compiled Host, its shipped `profiles/` content, the same-package client and `scripts/workflowctl.py` ship together. Native DSH Conversation supplies the child transcript and execution controls; the workflow client supplies the composer configuration picker and the Workflow settings page.

## Agent verification of the model-facing surface

The test suite covers the behaviour behind the tool: planning, delegation boundaries, strategies, storage, and the Host's routing. It cannot cover the tool's *model-facing* surface — the action set, the parameter semantics, and the error wording an agent actually reads. Those only fail inside a real conversation, so they are verified by holding one.

**Required whenever the tool's description, its parameters, its error text, or its action set changes.**

The transport is scripted and the judgement is not:

1. **A script drives the real conversation.** `scripts/dialog-check.mjs` authenticates against the running `dsh web` origin, creates a fresh Session, sends one ordinary user prompt, waits for the turn to settle, and prints the driving Session's transcript plus any Session the run created. It asserts nothing.

   ```bash
   DSH_TOKEN=<token from the `dsh web:` line> node scripts/dialog-check.mjs "<prompt>"
   ```

   The prompt must be a user-level goal with no parameter hints, so the run measures what an agent can work out from the tool description alone. Driving it by script is what makes the pass repeatable, and it goes through DSH rather than calling the plugin's Host methods directly: only the conversation crosses the model-facing surface.
2. **The reply is parsed, not asserted.** A reply is not deterministic, so no fixed expectation is encoded. An agent reads the printed transcript and decides whether the subagent actually started, whether it executed, and whether it is healthy.

The flow to drive, and what to judge:

1. Start a child with `codex_workflow { action: "delegate", role: "evidence_runner", text: "<a greeting>" }`. `evidence_runner` is bound to `gpt-5.6-luna` at medium effort and edits no source, so the pass stays cheap. The result must carry `reply: null` with a note saying where the reply will arrive; a bare handle is the defect that field replaced.
2. Confirm **one** notice settles the child, and that it is the runtime's own — the workflow plugin contributes none, so two notices for one settlement is a defect. It names the child and carries its closing message, or states that the child left none.
3. Confirm the caller neither polls, sleeps, nor spends a second call waiting for the reply: it ends its turn, and the runtime's notice carries the reply into the next one. Re-reading a settled child with `{ action: "delegate", child: "<handle>" }` still returns `reply` from the durable report — the notice is a wake-up, the report is what survives one that was never delivered.
4. Send a second turn on the *same* child with the returned handle — `{ action: "delegate", child: "<handle>", text: "<a follow-up>" }` — and confirm the reply continues that conversation instead of starting another.
5. Confirm the caller never reaches for `codex_workers` with that handle: it tracks its own workers, so its `get` refuses and its `reports` returns an empty list while ignoring the id.
6. Stop the current turn with `{ action: "delegate", child: "<handle>", stop: true }` and confirm the returned child state changes.
7. Confirm that none of the above demands `adopt` or a `generation`: delegation is the generation-free path.

Judge the **reply**, not whether the call returned. A defect such as reading `task` where `text` is required, or an error that does not name the field to pass, is visible only in the transcript. Both were found this way; the ones that became assertable are covered by `test/delegate.test.mjs`.

## Remaining validation and development work

The adjacent provider's `EXECUTION.md` records isolated profile A/B creation and cold Agent resume. `evidence/workflow-contract-live-result.json` now records real T001/T002 dispatch, result recording, acceptance, integration and release, including an independent reviewer for T002. `evidence/browser-host-recovery-result.json` records provider Host cold recovery and native child/draft isolation. Provider-only and provider+workflow isolated package checks passed. Workflow profile UI, approval/interruption browser behavior and failure scenarios still require their own evidence; these bounded passes do not certify every workflow path.

`npm run pack:check` stages fresh source builds and verifies provider-only and provider+workflow tarball installs with the coordinated DSH overrides. It retains the temporary directory and prints its path. The runtime check mounts real Cordis services without calling a model; browser and real workflow delivery are separate checks.

`npm run dev -- --profile <prepared-profile> --app-provider /absolute/provider-checkout` uses the prepared profile's native bundle layers and ordered `--patch` overlays. The profile resolves `dsh-codex-app-provider` to that checkout and loads it before `dsh-workflow-kit`, with an absolute provider stateDir and enabled HMR roots covering only workflow lib. `DSH_CODEX_APP_PROVIDER_CHECKOUT` supplies the checkout when the flag is omitted. Linux owner inspection reuses only the same official Host/profile and leaves a reused Host running on exit.

Real-model validation of the controlled switch (Codex thread handover to a successor child, Codex → DeepSeek successor continuation) requires rebuilding and installing the coordinated DSH and provider package set first; this package's tests cover the contracts and the Host's routing with simulated adapters, and report the missing capability instead of silently running the old configuration.

Both watchers publish complete staged builds atomically. Provider execution-source changes pause publication until restart; the unified provider lib is excluded from Host HMR. Client-only provider changes can rebuild the bundle for page refresh. Workflow source changes retain native HMR while its watcher also pauses after provider execution changes. No production profile is changed by these checks.
