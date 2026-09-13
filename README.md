# dsh-workflow-kit

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

The two configurations this package ships are plugin content: `profiles/gpt-workflow.json` (`codex` provider) and `profiles/ds-workflow.json` (`deepseek-official/deepseek-flash`, with the codex `high`/`medium` effort split translated to `max`/`high`). Each maps the fixed role catalog to explicit `provider`, `model` and `reasoningEffort` values. Role developer instructions are composed at run time from `lib/generated/prompts.ts` and the deployment's installed skill layout; nothing is installed into DSH home, and per-deployment state lives only in the `dsh-workflow-kit` settings namespace.

The Host resolves each role through three layers: the stored user override, the shipped configuration, then the shipped role default. Stored overrides are sparse, so editing one role leaves the others inherited, and clearing a configuration's stored section reverts it whole. A stored configuration whose id matches a shipped one overrides it; any other id is a user-authored configuration. The Workflow settings page writes those overrides as path mutations, and the composer picker only selects.

`defaultProfile` is the deployment fallback for the stored default: the settings page's `defaultConfig` wins, and an unset stored default falls back to this entry config. The effective default initializes each native parent Session's selection once. An unset default leaves the selection empty. Switching configurations affects future children; existing children keep their recorded provider, model, effort, instructions and execution limits through continuation and cold Agent resume. A deleted selected configuration stays selected and blocks new creation until a valid selection is made.

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

## Remaining validation and development work

The adjacent provider's `EXECUTION.md` records isolated profile A/B creation and cold Agent resume. `evidence/workflow-contract-live-result.json` now records real T001/T002 dispatch, result recording, acceptance, integration and release, including an independent reviewer for T002. `evidence/browser-host-recovery-result.json` records provider Host cold recovery and native child/draft isolation. Provider-only and provider+workflow isolated package checks passed. Workflow profile UI, approval/interruption browser behavior and failure scenarios still require their own evidence; these bounded passes do not certify every workflow path.

`npm run pack:check` stages fresh source builds and verifies provider-only and provider+workflow tarball installs with the coordinated DSH overrides. It retains the temporary directory and prints its path. The runtime check mounts real Cordis services without calling a model; browser and real workflow delivery are separate checks.

`npm run dev -- --profile <prepared-profile> --app-provider /absolute/provider-checkout` uses the prepared profile's native bundle layers and ordered `--patch` overlays. The profile resolves `dsh-codex-app-provider` to that checkout and loads it before `dsh-workflow-kit`, with an absolute provider stateDir and enabled HMR roots covering only workflow lib. `DSH_CODEX_APP_PROVIDER_CHECKOUT` supplies the checkout when the flag is omitted. Linux owner inspection reuses only the same official Host/profile and leaves a reused Host running on exit.

Both watchers publish complete staged builds atomically. Provider execution-source changes pause publication until restart; the unified provider lib is excluded from Host HMR. Client-only provider changes can rebuild the bundle for page refresh. Workflow source changes retain native HMR while its watcher also pauses after provider execution changes. No production profile is changed by these checks.
