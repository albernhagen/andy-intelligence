---
status: accepted
date: 2026-11-06
amends: 0063 (Bash containment, Change out)
---

# 0071 — Build sandbox: `.git` writable, a live sandbox check before the agent, placeholders dropped

Built in AI-42: Build sandbox: every Bash call fails on .git/config.lock, and mount placeholders leak into the PR. Amends ADR-0063: Build run protocol.

## Context and Problem Statement

The live sandbox proof (runbook `agent-runs.md` §9, 2026-11-06, `docs/build-log/2026-11-06-sandbox-proof-failed.md`) failed. The profile's `filesystem.denyWrite: ["<checkout>/.git"]` bound `.git` read-only; Claude Code's sandbox then couldn't create its placeholder at `.git/config.lock`, so every Bash call failed (`bwrap: Can't create file at …/.git/config.lock: Read-only file system`). The `bwrap --ro-bind / / … true` step had printed "Sandbox ready" anyway: it never ran Claude Code's own wrapper. Seven empty placeholders the sandbox binds for protected files the repo lacks (`.gitmodules`, `.npmrc`, `.yarnrc`, `.yarnrc.yml`, `bunfig.toml`, `package-lock.json`, `yarn.lock`) stayed behind and reached the PR.

Claude Code's sandbox docs (code.claude.com/docs/en/sandboxing, "Protected paths") already write-deny, inside the working directory, "`hooks` and `config` inside `.git`", shell startup files, `.gitconfig`, `.mcp.json` and `.claude` settings; the list isn't configurable short of `filesystem.disabled`. On Linux a missing protected file gets "a 0-byte read-only placeholder" that "the sandbox removes … afterward", except when a session is killed or exits mid-command.

## Decision Outcome

| Topic         | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.git`        | No `denyWrite` on `.git`: the agent's Bash may write the index, objects, refs and lock files (git and `pnpm test` need them). `.git/config` and `.git/hooks` stay read-only by the sandbox's own protected paths, and the Edit tool keeps `Edit(//**/.git/**)` denied. Nothing after the agent uses the checkout's `.git`: the collect step runs git from the copy taken before the agent (ADR-0063), and the publish job checks out the base commit fresh.                                                                                                                                                       |
| Sandbox check | Replaces the `bwrap` "Sandbox ready" claim. Before the agent, one extra run of the same pinned `claude-code-action` under the same managed settings and env, with a fixed prompt (no ticket text), Haiku, 3 turns, 5 minutes: one Bash call runs `git update-index --refresh` (takes `index.lock`), `git status`, checks the model and GitHub credential variables are empty and writes `sha256(nonce)` into the checkout. The next step compares the hash and fails the job (no agent run) if it is missing or wrong; the report says "The sandbox check failed". The `bwrap` call stays as a runner diagnostic. |
| Placeholders  | Before `git add -A`, the collect step runs `executor-publish.mjs drop-placeholders`: a listed protected file (`SANDBOX_PLACEHOLDERS`: the seven above and the documented ones) is deleted and logged if it is an empty regular file, not a symlink, not below a symlinked directory, and not in the manifest of workspace files taken before the sandbox check. Anything else stays in the change and meets the publish checks as before.                                                                                                                                                                         |

### Consequences

- Good: the agent can run git and the project's checks; a sandbox that breaks Bash, or exposes a credential variable, stops the run before the agent spends anything; the check exercises the real wrapper, not a stand-in.
- Accepted: the check is a model call (about a cent with Haiku) on every build run, which ADR-0063 had ruled out. The agent can now write `.git` internals other than `config` and `hooks` (e.g. `info/`, `refs`) in a checkout that nothing trusted reads after it. An agent that deliberately creates an empty listed file loses it, with a log line.
- Bad: the check trusts the model to run one command; it can't fake the hash, but it can refuse, which fails the run (fail closed). The placeholder list follows Claude Code's undocumented behaviour; a new protected file shows up as an empty file in a PR until it is added.
