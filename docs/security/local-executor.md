# Threat model: Local executor

The runner on Andy's Mac (`apps/local-runner`, ADR-0089, ADR-0098, ADR-0102). Risk register: [threat-model.md](threat-model.md) (R-AI-44). Control-plane entry points (claim, callbacks, `POST /github/token`): [entry-points-and-credentials.md](entry-points-and-credentials.md).

## Processes and what each can reach

Every process below runs as the runner's macOS user (`ai-runner`) under a Seatbelt profile the runner writes for each task. The base rule denies file contents and writes under `/Users`, the runner user's home and the runner's directory; each profile reopens only what is listed.

| Process                                   | Reads                                                                | Writes                               | Network            | Credentials it holds                                                             |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------ | ------------------ | -------------------------------------------------------------------------------- |
| Runner                                    | Everything it owns                                                   | Its directory                        | Control plane, git | Runner secret (Keychain, memory), per-run token, push token (memory only)        |
| Agent, refine or plan                     | Checkout, settings file, Claude Code's own files                     | Claude Code's own files              | On (its API)       | The runner user's Claude login                                                   |
| Agent, build                              | Settings file, the repo's cache (git reads), Claude Code's own files | Its checkout, `/tmp/agent`           | On (its API)       | The runner user's Claude login; Bash runs in Claude Code's sandbox or not at all |
| Platform child (settings, prompt, report) | Platform checkout, checkout, agent stream                            | Nothing                              | Off; no Keychain   | None                                                                             |
| Install child (build, `pnpm-lock.yaml`)   | pnpm                                                                 | Checkout, its own store and home     | On; no Keychain    | None; scripts and pnpmfile off                                                   |
| Publish child (build with a change)       | Platform checkout, the patch                                         | Its fresh worktree, the repo's cache | On; no Keychain    | Push token (stdin; to git through `GIT_CONFIG_*` env, as on Actions)             |

## The push token (ADR-0102)

- Asked for only after the build agent exited and its change was collected, with the run's per-run token. The control plane grants it once per run, only while the run is `running`, only to the runner that claimed it, for the run's project repo; a second request is `403`.
- The publish child runs the platform's own `scripts/executor-publish.mjs` `publish()` unchanged: path and protected-path rules, symlinks and submodules refused, 200 files, `agent/<KEY>/<runId>` branch, never forced, PR as the App bot. A refused change pushes nothing and fails the run.
- Never logged, stored or reported: the harness drops `::add-mask::` lines and strips the token from every line and error it passes back; the runner checks the child's answer's shape.

## Residual risk

- A 1-hour App token for one repo is on the Mac during publish: agent branches and PRs on that repo, never `main` (ruleset).
- A process the build agent leaves behind can outlive it during publish. It keeps the agent's profile (no work-directory reads); current macOS doesn't show another process's environment, so git's credential variable isn't readable.
- Platform code from `main` runs in the platform and publish children (ADR-0098); the publish child holds the push token, as the Actions publish job does.
- Whether Claude Code's sandbox starts inside Seatbelt is unproven: if not, Bash is refused (`failIfUnavailable`) and builds that need Bash fail.

## Manual live checks (Andy, before builds go local)

1. A `local` build of a small ticket opens `agent/<KEY>/<runId>` as the App bot; the runner's log has no token.
2. Cloud Logging shows `push token granted` once for that run (with its `runnerId`); no `second push token request` warning.
3. In the build agent, a Bash `curl https://example.com` fails (Claude Code's proxy) or Bash is refused; neither reads `~/.local-runner`.
4. A build that edits `.github/` fails with "protected" and pushes nothing.
