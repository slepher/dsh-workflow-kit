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

## Execution control and cost

A phase may authorize a worker to end its turn with a control report instead of a final result. Only a `bootstrap` opening phase authorizes `Execution control: handoff`; the Host then creates a successor child of the same task and attempt on the bound def configuration, as a sibling under the same parent Session, and records the source turn, target tier, request id and message id. The stable identity is the assignment, its task/attempt/lane and — inside Codex — its original thread, never the DSH child: the source keeps its history and reports but cannot continue. The continuation is delivered once: repeated observation reuses the recorded handoff, and the handoff turn is never read as a candidate result. A report the phase does not authorize is recorded on the attempt as a fact (`control`), never performed.

`Execution control: consult` is authorized for `adaptive` and for a bootstrap continuation. The Host starts one expert child on the Profile's sup configuration bound only to the consultation prompt, with a read-only boundary over the requesting workspace (writes go to the expert's own artifacts), and records the question, contract revision and evidence against the attempt. The same question is never sent to a second expert. When the expert finishes, its conclusion returns to the requesting worker as a continuation prompt that states the advice is not acceptance; the requesting worker keeps its own configuration, implements the result and verifies it. The expert child is acknowledged with the consultation, so release never leaves one unhandled.

A handoff whose target configuration resolves to another provider does not share the native thread: the Host creates a sibling successor child that owns a fresh DSH session, reads the previous adapter's recorded execution facts — commands with their exit status, changed paths, tool results and searches, each carrying its durable item identity, with long output shortened and pointed at that identity — and carries them in the successor's continuation prompt as already-performed facts. Inside Codex the successor keeps the original thread through the provider's controlled handover. Turns after the switch are read from the successor's own DSH session log, so completion never depends on the previous adapter's thread identity; a failed turn on the new adapter reports failure instead of stalling.

Inside Codex, the thread handover needs the installed provider package's trusted `ctx.codexHandoff` service; across providers, the fact import needs its sourced execution-fact projector. The Host reports `handoffSupport: { supported, threadHandoff, factImport, reason? }` for the installed package set and refuses a handoff with its concrete reason when that set lacks the capability the route needs, recording the refusal on the attempt instead of delivering a continuation that would silently keep the old configuration.

Token accounting is read-only: each native turn's usage reaches the Host through `codexExecution.read`, is stored per `workerId:turnId` so repeated observations never double-count, and is summed per task and per run. The parent agent's own coordinating requests are read from its session log and reported separately as `coordination`. A turn whose provider reported no usage is counted as `unreported` rather than as a zero-cost call, and an attempt's declared `Outcome` is preserved verbatim (`blocked`, `needs-decision` and `needs-verification` never collapse into one anonymous state). The summary states that no billing feed is configured, so money is never derived from token counts; a cost dashboard stays out of scope for this round.

`defaultProfile` is the deployment fallback for the stored default: the settings page's `defaultConfig` wins, and an unset stored default falls back to this entry config. The effective default initializes each native parent Session's selection once. An unset default leaves the selection empty. Switching configurations affects future children; existing children keep their recorded provider, model, effort, instructions and execution limits, a handoff successor is created from the bound Profile snapshot, and a cold Agent resume uses the recorded configuration. A deleted selected configuration stays selected and blocks new creation until a valid selection is made.

The Host registers `codex_workflow` for adopted task contracts and uses native child creation, prompt queue/steer and interruption. It reads execution facts through `codexExecution.read`; a native completed turn remains pending workflow acceptance. Unknown execution never authorizes takeover or redispatch. Workflow unload removes its tool and profile RPC; it does not close Codex execution or delete Session history.

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
3. Confirm the caller never spends a second call to learn the reply, and that re-reading a settled child with `{ action: "delegate", worker: "<handle>" }` returns `reply` from the durable report — the notice is a wake-up, the report is what survives one that was never delivered.
4. Send a second turn on the *same* child with the returned handle — `{ action: "delegate", worker: "<handle>", text: "<a follow-up>" }` — and confirm the reply continues that conversation instead of starting another.
5. Stop the current turn with `{ action: "delegate", worker: "<handle>", stop: true }` and confirm the returned child state changes.
6. Confirm that none of the above demands `adopt` or a `generation`: delegation is the generation-free path.

Judge the **reply**, not whether the call returned. A defect such as reading `task` where `text` is required, or an error that does not name the field to pass, is visible only in the transcript. Both were found this way; the ones that became assertable are covered by `test/delegate.test.mjs`.

## Remaining validation and development work

The adjacent provider's `EXECUTION.md` records isolated profile A/B creation and cold Agent resume. `evidence/workflow-contract-live-result.json` now records real T001/T002 dispatch, result recording, acceptance, integration and release, including an independent reviewer for T002. `evidence/browser-host-recovery-result.json` records provider Host cold recovery and native child/draft isolation. Provider-only and provider+workflow isolated package checks passed. Workflow profile UI, approval/interruption browser behavior and failure scenarios still require their own evidence; these bounded passes do not certify every workflow path.

`npm run pack:check` stages fresh source builds and verifies provider-only and provider+workflow tarball installs with the coordinated DSH overrides. It retains the temporary directory and prints its path. The runtime check mounts real Cordis services without calling a model; browser and real workflow delivery are separate checks.

`npm run dev -- --profile <prepared-profile> --app-provider /absolute/provider-checkout` uses the prepared profile's native bundle layers and ordered `--patch` overlays. The profile resolves `dsh-codex-app-provider` to that checkout and loads it before `dsh-workflow-kit`, with an absolute provider stateDir and enabled HMR roots covering only workflow lib. `DSH_CODEX_APP_PROVIDER_CHECKOUT` supplies the checkout when the flag is omitted. Linux owner inspection reuses only the same official Host/profile and leaves a reused Host running on exit.

Real-model validation of the controlled switch (Codex thread handover to a successor child, Codex → DeepSeek successor continuation) requires rebuilding and installing the coordinated DSH and provider package set first; this package's tests cover the contracts and the Host's routing with simulated adapters, and report the missing capability instead of silently running the old configuration.

Both watchers publish complete staged builds atomically. Provider execution-source changes pause publication until restart; the unified provider lib is excluded from Host HMR. Client-only provider changes can rebuild the bundle for page refresh. Workflow source changes retain native HMR while its watcher also pauses after provider execution changes. No production profile is changed by these checks.
