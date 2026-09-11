# Development host

Use a dedicated `workflow-dev` profile and the official `0.1.5-rc.1` `dsh` on PATH.

For two fresh adjacent source checkouts, run `npm run prepare:local` once from
`dsh-workflow-kit`. This performs the Codex locked install, installs only the
matching adjacent backend into workflow `node_modules` with npm `--no-save`,
and builds backend then Codex. It verifies that neither repository manifest nor
lock changes. Until backend `0.1.0` is published, standalone workflow `npm ci`
correctly remains unavailable; do not replace the published-version dependency
with a checkout path.

The profile bundle order is `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `dsh-codex-kit-backend`, `dsh-codex-kit`, then `dsh-workflow-kit`. Configure one backend state directory and one workflow state directory under the profile. Enable HMR for the Codex UI and workflow `lib` directories; exclude the backend because backend changes require a host restart.

Run `npm run dev -- --profile workflow-dev`. The command starts the adjacent Codex watch-only entry, waits for its exact `dsh-codex-kit watch ready` line (after backend then Codex UI build), builds workflow, and starts its watcher. If the effective backend state is already owned by a live DSH Host running that profile, dev reuses it; otherwise dev starts one Host on port `0` using the official rc.1 `dsh` on PATH. The workflow build emits `lib/client.js` as the rc.1 `window.__ModuleLoader__.load` closure for `dsh-workflow-kit`; each workflow source change reruns that complete build for client HMR. `--codex-kit`, `DSH_CODEX_KIT_CHECKOUT`, `--profile`, and `DSH_PROFILE` retain their existing checkout/profile overrides. SIGINT or SIGTERM stops the two watchers and only a Host started by this command.

For a temporary `stateDir` conflict, add repeatable `--patch
/absolute/path/to/overlay.yml` pairs. Every value must resolve to an existing
file; pairs are forwarded in their given order to that same PATH `dsh` Host.
They do not rewrite the profile bundle list or alter HMR configuration. Dev
cleanup never stops a reused Host from another run.
