---
status: proposed (AI-133; Andy decides at review)
date: 2026-11-12
amends: 0089 (publish and the push token for a local build), 0098 (no pre-agent Bash check in this slice)
---

# 0102 — Local build and publish: the platform's own publish script, one push token, fail-closed Bash

AI-133: Local executor: local build and publish (ADR-0089 slice 6). The runner now runs build tasks. Sync tasks stay on GitHub Actions (ADR-0094: the claim never hands one out).

## Decisions

| Topic       | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                | Why                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Push token  | `POST /github/token` takes the per-run token of a local build that is `running`, once (`claimPushGrant`, amends ADR-0063); the token is for the run's project repo. The runner asks only after the agent exited and its change was collected.                                                                                                                                                                                         | The grant rules Actions has: one run, one token, refused after the run ended or the runner was revoked.                                                                                                                          |
| Publish     | The runner runs `publish()` from the platform checkout's `scripts/executor-publish.mjs`, unchanged, in a child under the runner's Seatbelt profile (network on, no Keychain). A runner-owned harness answers the script's Actions OIDC exchange in memory with the token the runner already holds. The token reaches the child on stdin; the harness drops the script's `::add-mask::` lines and strips the token from anything else. | The same path rules, protected paths, caps, branch and PR as Actions, with no second copy of them. The child never sees the runner secret or the per-run token.                                                                  |
| Change      | Collected as on Actions (`git add -A`, binary diff, no external diff or textconv, 5 MiB cap), with the worktree's git directory read before the agent started, never through the checkout's `.git` file. Published from a fresh worktree at the agent's base commit.                                                                                                                                                                  | The agent can rewrite its checkout's `.git` file, not the git directory outside it.                                                                                                                                              |
| Build agent | Writes its checkout only; reads (not writes) the repository cache, so `git` works for reading; `TMPDIR=/tmp/agent` as on Actions. The profile's rules decide its tools, as on Actions. Dependencies: `pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile` first when `pnpm-lock.yaml` exists, in its own Seatbelt profile (network on, no Keychain).                                                                   | Same tools and install rules as Actions (ADR-0063, ADR-0072).                                                                                                                                                                    |
| Bash check  | Not brought back in this slice (ADR-0098 said slice 6 would). Bash runs only in Claude Code's own sandbox, as the build profile already sets: `failIfUnavailable: true`, `allowUnsandboxedCommands: false`. If that sandbox can't start inside the runner's Seatbelt, Bash is refused, never run unconfined. Either way the runner's Seatbelt still holds around every command. Andy's first live build shows which it is.            | A model call before each build, without knowing yet whether a nested macOS sandbox works at all. Failing closed keeps the agent no less confined than Edit and Write alone. Placeholders are bubblewrap's (ADR-0071): none here. |

## Residual risk (R-AI-44)

- A 1-hour App token for one repo is on the Mac during publish (ADR-0089 open question 4). It can push agent branches and open PRs, never `main` (ruleset).
- A process an injected agent leaves behind (`setsid`) can outlive it while publish runs. It stays in the agent's Seatbelt profile (no reads of the work directory). Current macOS doesn't show another process's environment to a process of the same user, so git's credential variable isn't readable (checked 2026-11-12).
- If Claude Code's sandbox does start inside Seatbelt, Bash's network goes through its proxy (registry only). If it doesn't, Bash is off and builds that need it fail.

## Open question for Andy

After the first live build: is a pre-agent Bash check (ADR-0071's, with a Haiku call) still worth adding? Bash either runs inside Claude Code's sandbox or is refused, so the check would mainly turn a confusing agent failure into a clear one.

## Consequences

- Good: a `local` build opens the same `agent/<KEY>/<runId>` PR as Actions, through the same checks, and asks for its push token once.
- Bad: whether Bash works in a local build is known only after a live run.
