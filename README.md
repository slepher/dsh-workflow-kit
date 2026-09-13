# dsh-workflow-kit

Workflow owns role/profile files, native Session profile selections, task contracts, lanes, acceptance, integration and release. Codex execution runs through DSH native children and the single `dsh-codex-app-provider` Host plugin. The same package provides a `./client` profile selector in the native Conversation header.

## Runtime configuration

Load `dsh-codex-app-provider` before this package. Configure one workflow entry:

```yaml
- id: dsh-workflow-kit
  config:
    stateDir: /absolute/isolated/state/workflow
    workflowSkillDir: /absolute/skills/codex-workflow
    implementationStandardDir: /absolute/skills/audit-implementation-simplicity
    subdir: workflow-kit
    defaultProfile: workflow-default
```

`stateDir` contains workflow records, acceptance and native child creation snapshots. Native Session/thread execution state and terminal report contents remain execution-owned. Existing legacy data is retained. `workflowSkillDir` identifies the installed task-contract tooling and role protocols. The optional implementation standard directory defaults to the sibling `audit-implementation-simplicity` skill.

`subdir` is relative to DSH home (`DSH_HOME`, or `~/.dsh`), independent of cwd. Absolute paths, dot segments and symlink escapes are rejected. `roles/*.md` supplies complete developer instructions; `profiles/*.json` maps role IDs to explicit model and reasoningEffort values. The Host validates ordinary files, isolates invalid profiles and never falls back to another profile. Configuration is refreshed explicitly.

`defaultProfile` initializes each native parent Session's selection once. An unset default leaves the selection empty. Switching profiles affects future children; existing children keep their recorded model, effort, instructions and execution limits through continuation and cold Agent resume. A deleted selected profile stays selected and blocks new creation until a valid selection is made.

The Host registers `codex_workflow` for adopted task contracts and uses native child creation, prompt queue/steer and interruption. It reads execution facts through `codexExecution.read`; a native completed turn remains pending workflow acceptance. Unknown execution never authorizes takeover or redispatch. Workflow unload removes its tool and profile RPC; it does not close Codex execution or delete Session history.

## Install role configuration

Installation is explicit and uses the target deployment's effective DSH bundle, profile, home and ordered patch layers. The command does not start a Host or create a missing profile:

```bash
npm run install:configuration -- --profile workflow-dev --dsh-home /absolute/dsh-home
# Add the same repeatable --patch paths used by the deployment when applicable.
```

The installer and Host share the same directory resolver. Installation requires literal path fields and enabled state in the effective configuration; it does not evaluate `!!js`. DSH overlays replace the complete `config` value, so include the required fields in the final override. The installer checks installed skill references, writes seven role files and `workflow-default.json`, and reports different existing files without overwriting them. Custom files remain untouched. After installation, use the profile selector's Refresh action in an already running Host.

## Build and validation

Requires Node >=22.19, Python 3, Git, `dsh-codex-app-provider` 0.1.0 and a coordinated DSH package set containing the native execution interfaces. The checked-in dependency locks identify local tarballs built from DSH 0.1.5-rc.1 source with changes; registry rc.1 alone does not implement those interfaces.

Build and pack the provider and coordinated DSH dependencies first, then:

```bash
npm run prepare:local
npm run build
node --test --test-isolation=none test/install-configuration.test.mjs test/prepare-local.test.mjs test/profile-rpc.test.mjs test/host.test.mjs test/native-workers.test.mjs test/backend-consumer.test.mjs test/workflow.test.mjs test/configuration.test.mjs test/store.test.mjs
```

`prepare:local` checks local tarballs before running locked `npm ci`; it does not build or modify another checkout. The compiled Host, same-package client, configuration installer and `scripts/workflowctl.py` ship together. Native DSH Conversation supplies the child transcript and execution controls; the workflow client supplies only profile controls.

## Remaining validation and development work

The adjacent provider's `EXECUTION.md` records isolated profile A/B creation and cold Agent resume. `evidence/workflow-contract-live-result.json` now records real T001/T002 dispatch, result recording, acceptance, integration and release, including an independent reviewer for T002. `evidence/browser-host-recovery-result.json` records provider Host cold recovery and native child/draft isolation. Provider-only and provider+workflow isolated package checks passed. Workflow profile UI, approval/interruption browser behavior and failure scenarios still require their own evidence; these bounded passes do not certify every workflow path.

`npm run pack:check` stages fresh source builds and verifies provider-only and provider+workflow tarball installs with the coordinated DSH overrides. It retains the temporary directory and prints its path. The runtime check mounts real Cordis services without calling a model; browser and real workflow delivery are separate checks.

`npm run dev -- --profile <prepared-profile> --app-provider /absolute/provider-checkout` uses the prepared profile's native bundle layers and ordered `--patch` overlays. The profile resolves `dsh-codex-app-provider` to that checkout and loads it before `dsh-workflow-kit`, with an absolute provider stateDir and enabled HMR roots covering only workflow lib. `DSH_CODEX_APP_PROVIDER_CHECKOUT` supplies the checkout when the flag is omitted. Linux owner inspection reuses only the same official Host/profile and leaves a reused Host running on exit.

Both watchers publish complete staged builds atomically. Provider execution-source changes pause publication until restart; the unified provider lib is excluded from Host HMR. Client-only provider changes can rebuild the bundle for page refresh. Workflow source changes retain native HMR while its watcher also pauses after provider execution changes. No production profile is changed by these checks.
