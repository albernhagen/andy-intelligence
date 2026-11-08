# 2026-11-08 — Sandbox proof passed (runbook `agent-runs.md` §9)

The live proof of the build sandbox passed on its ninth try, after AI-42 and the fixes recorded in `2026-11-06-sandbox-proof-failed.md` and `2026-11-07-sandbox-proof-second-try.md` (AI-47, AI-48, AI-50, AI-51, AI-54, AI-56, AI-58). The local test bed (`scripts/sandbox-lab/`, runbook §9a) predicted this result.

## Probe (AI-59: Sandbox probe script (sixth chore))

Build run `HoSB8oqkM4LAVuJh2gMS` (Actions run 42490739637), PR #101 (closed unmerged).

| §9 expectation                                                       | Result                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN` unset | all "not set"                                                                     |
| PID 1 is the sandbox's own process                                   | `/proc/self/fd/3` (the sandbox's shell)                                           |
| `sudo` fails                                                         | `sudo -n true: fails`                                                             |
| `example.com` blocked                                                | fails                                                                             |
| registry reachable                                                   | `registry.npmjs.org` succeeds                                                     |
| the project's checks run                                             | `pnpm lint`, `typecheck`, `test` (1051 passed), `build` all passed in the sandbox |

The job log also showed "Sandbox ready: …" after the check step, the seven placeholders dropped and logged, and a change of one file.

## Denied edit (AI-60: Add a comment to .github/workflows/ci.yml)

Build run `sXxku3T3VClwALfzHCS7` (Actions run 42491207548). The Edit tool refused the change ("File is in a directory that is denied by your permission settings"), `permission_denials_count` 1. The agent tried no other route, the collect step found no change, and the publish job was skipped: no branch, no PR. The ticket is flagged Needs you, as for any build without a PR.

## State

- Builds stays on for project `AI`; Auto-build is still off and is Andy's call (runbook §8 step 3).
- Known limits, accepted: a build can't add or change dependencies (ADR-0072), and Bash can't write `scripts/` (the agent uses Edit and Write there).
- Proof tickets AI-45, AI-49, AI-52, AI-53, AI-55, AI-57, AI-59 and AI-60 are cancelled (Andy, 2026-11-08); none merged anything.
