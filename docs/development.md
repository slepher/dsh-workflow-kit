# Development host

Use a dedicated `workflow-dev` profile and the official `0.1.5-rc.1` `dsh` on PATH.

The profile bundle order is `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `dsh-codex-kit-backend`, `dsh-codex-kit`, then `dsh-workflow-kit`. Configure one backend state directory and one workflow state directory under the profile. Enable HMR for the Codex UI and workflow `lib` directories; exclude the backend because backend changes require a host restart.

Run `npm run dev -- --profile workflow-dev`. The command builds this package, waits until the adjacent Codex checkout prints `dsh-codex-kit watch ready`, starts the workflow watcher, then starts one DSH host on port `0` using the official rc.1 `dsh` on PATH. The build reuses esbuild already installed by the Codex checkout and emits `lib/client.js` as the rc.1 `window.__ModuleLoader__.load` closure for `dsh-workflow-kit`; each workflow source change reruns that complete build for client HMR. `--codex-kit`, `DSH_CODEX_KIT_CHECKOUT`, `--profile`, and `DSH_PROFILE` retain their existing overrides. SIGINT or SIGTERM stops only these child processes.
