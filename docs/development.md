# Development host

Use a dedicated `workflow-dev` profile and the official `0.1.5-rc.1` `dsh` on PATH.

For two fresh adjacent source checkouts, run `npm run prepare:local` once from
`dsh-workflow-kit`. This performs the Codex locked install, installs only the
matching adjacent backend into workflow `node_modules` with npm `--no-save`,
and builds backend then Codex. It verifies that neither repository manifest nor
lock changes. Until backend `0.1.0` is published, standalone workflow `npm ci`
correctly remains unavailable; do not replace the published-version dependency
with a checkout path.

The profile bundle order is `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `dsh-codex-kit-backend`, `dsh-codex-kit`, then `dsh-workflow-kit`. Configure one backend state directory and one workflow state directory under the profile. HMR roots are exactly backend `lib/host`, Codex `lib`, and Workflow `lib`; backend core output is excluded because it requires a Host restart.

Run `npm run dev -- --profile workflow-dev`. A live exact-profile owner is checked before builds and reused with both watchers in `--no-initial-build` mode. Without an owner, Codex then Workflow build once, both watchers report ready, and the command starts one official PATH `dsh` Host on port `0`. Workflow builds in staging and atomically publishes only W `lib`; backend core changes permanently pause W and Codex consumer publication until the explicit restart handoff. `--codex-kit`, `DSH_CODEX_KIT_CHECKOUT`, `--profile`, and `DSH_PROFILE` retain their existing overrides. SIGINT or SIGTERM waits for the two owned watchers and stops only a Host started by this command.

For a temporary `stateDir` conflict, add repeatable `--patch
/absolute/path/to/overlay.yml` pairs. Every value must resolve to an existing
file; pairs are forwarded in their given order to that same PATH `dsh` Host.
They do not rewrite the profile bundle list or alter HMR configuration. Dev
cleanup never stops a reused Host from another run.
