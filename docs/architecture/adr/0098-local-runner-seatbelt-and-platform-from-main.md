---
status: accepted, amended by 0101
date: 2026-11-12
amends: 0089 (what the runner confines, and which platform commit it runs)
---

# 0098 — Local runner: Seatbelt around the agent and the platform scripts; platform from `main`

AI-131: Local executor: runner CLI (ADR-0089 slice 5). The review of PR #177 found three gaps in what ADR-0089 assumed.

- On the Mac, the executor profile arrives through `--settings`, not as managed settings. Its read denies are Linux paths, and Claude Code's own sandbox covers only Bash, which refine and plan don't use. So the profile alone doesn't keep an injected read-only agent away from the runner user's files.
- The context names no platform commit.
- The platform's scripts would run inside the process that holds the runner secret.

## Decisions

| Topic             | Choice                                                                                                                                                                                                                                                                                                                                                  | Why                                                                                                                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent confinement | The runner starts `claude` under `sandbox-exec` (Seatbelt) with its own profile. File contents and writes are denied under `/Users`, the runner user's home and the runner's directory. Reopened: the task's checkout and settings file (read only), and Claude Code's own install, config and caches.                                                  | An OS boundary around the whole process covers the Read, Glob and Grep tools, not only Bash. The profile is the runner's, so a platform commit can't widen it.                                                                                                                                           |
| Live check        | Before each agent the runner checks, under that profile and with no model call, that a file in the runner's directory can't be read, the checkout can be listed but not written, and the home's Keychain folder can't be listed. A failed check means a failed report, no agent and a kept work directory.                                              | Fails closed, and nothing a project's `CLAUDE.md` can steer. It replaces ADR-0089's Haiku Bash check for read-only steps: that check proved the build profile, which they never use. Slice 6 brings the Bash check back for build.                                                                       |
| Platform scripts  | They run in a child `node` process with `PATH` only, under a second Seatbelt profile: offline, no Keychain (Security server), and reading only the two checkouts and the agent's stream.                                                                                                                                                                | A bad platform commit can't reach the runner secret or a per-run token, which live only in the runner's memory. The runner checks what they return: contract schemas, its own tool flags, and settings limited to the profile's keys with hooks off (no `hooks`, `apiKeyHelper`, `statusLine` or `env`). |
| Platform commit   | `main` of the platform repo, fetched when each task starts and logged.                                                                                                                                                                                                                                                                                  | The context has no platform SHA (contracts are additive-only and out of this slice's scope). Actions also runs the executor from `main`. Until a `platformSha` exists, `main` is part of the runner's trusted base.                                                                                      |
| Orphans           | Agents run in their own process group. They die with the runner: on exit, on a second signal, on an uncaught error, through a watchdog (SIGKILL or a crash), and through `agent.pid` (agent and owning runner, checked by start time) at the next `start`, only once that runner is gone. `start` takes a lock per home, so a second runner is refused. | A lost runner must not leave an agent spending quota without a lease.                                                                                                                                                                                                                                    |

## Residual risk (R-AI-44)

- The base rule is `allow default`. Paths outside `/Users` that any local user can read, such as `/etc` and `/Library` (not other users' homes), stay readable.
- Claude Code's own files under the runner user's home (`~/.claude`, `~/.claude.json`) stay readable. On macOS the login itself is in the Keychain, and the profile denies `~/.claude/.credentials.json`.
- The agent process keeps network access (it needs the API) and Keychain access (its own login). Its read-only tools have no network or IPC of their own.
- A path Claude Code needs that the profile denies stops the agent. `local-runner check-settings` runs a real agent under the same profile, so Andy sees this before the first task.
- Anything merged to `main` of the platform repo runs in the platform child at the next task, inside the child's sandbox.

## Consequences

- Good: an injected refine or plan agent can't read the runner's secrets, other tasks' work or the runner user's files. A bad platform commit can't read the runner secret.
- Good: no Haiku call before each read-only task.
- Bad: `sandbox-exec` is deprecated by Apple, though still shipped and used by Claude Code itself. If it goes away, the runner refuses to run tasks.
