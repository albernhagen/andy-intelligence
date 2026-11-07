---
status: accepted
date: 2026-11-07
amends: 0063 (Tooling files, Bash containment)
---

# 0072 — Build dependencies are installed before the agent, outside the sandbox

Built in AI-54: Build sandbox: pre-install dependencies before the agent (node_modules is read-only inside). Amends ADR-0063: Build run protocol and builds on ADR-0071: Build sandbox.

## Context and Problem Statement

The runbook `agent-runs.md` §9 proof on 2026-11-07 (AI-52: Sandbox probe script (third chore)) held every sandbox expectation and reached the npm registry, but `pnpm install` failed with `EROFS` on `node_modules/.bin/eslint`. A diagnostic run (AI-53: Sandbox diagnostic: which mount makes node_modules/.bin read-only) showed that inside Claude Code's sandbox `node_modules` and `node_modules/.bin` are their own read-only bind mounts, like `package.json` and the lockfiles. No profile rule covers them: they appear to be Claude Code's own protected package-manager paths, which settings can't lift short of `filesystem.disabled`. So the agent can't install dependencies, and without them it can't run the project's checks. ADR-0063 had let a build add a dependency (flagged as a tooling change).

## Decision Outcome

| Topic   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install | Before the agent, a workflow step runs `pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile` outside the sandbox, from the lockfile of the commit the agent starts from (the default branch), when the project has `pnpm-lock.yaml`. Lifecycle scripts and `.pnpmfile.cjs` hooks are off, so no package or project code runs in the job that holds the model credential; pnpm still reads the repository's `.npmrc` and workspace settings. A failed install fails the job before the agent. Decided by Andy, 2026-11-07. |
| Store   | Under runner temp, which sandboxed commands can't read (`denyRead`), so the agent can't alter the store files behind `node_modules`' hardlinks.                                                                                                                                                                                                                                                                                                                                                                                         |
| Agent   | The build procedure says dependencies are installed and read-only: no `pnpm install`, and no new or changed dependencies; a ticket that needs one is recorded in `deviations` and the build stops.                                                                                                                                                                                                                                                                                                                                      |

### Consequences

- Good: the agent runs the project's checks against the exact locked dependencies; the install runs no code; nothing inside the sandbox is loosened.
- Bad: a build can't add, remove or upgrade a dependency; those tickets are done by hand until there is a reviewed way (e.g. an install step the gate re-runs from the agent's lockfile). Tools that write caches into `node_modules` (e.g. `node_modules/.vite`) fail inside the sandbox; proven only by the next live run.
- Accepted: the install trusts the default branch's lockfile and `.npmrc` and the registry's integrity hashes, as CI does.
