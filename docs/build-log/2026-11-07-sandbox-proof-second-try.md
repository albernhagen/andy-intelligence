# 2026-11-07 — Sandbox proof, second try: stopped by the `.git` tamper check; fixed by AI-47: Sandbox check fails on the action's own .git/config and info/exclude writes

## The proof (runbook `agent-runs.md` §9)

- **Run:** ticket AI-45: Sandbox probe script, build run `8hJoiMkHrb1pXM00Nv57` (Actions run 42349335711) and its automatic retry `mB3fwey24PJtUHVKfIaA` (42349397208), after AI-42 (PR #88) merged and deployed. Builds on, Auto-build off.
- **Seen:** bubblewrap could make its namespaces; the "Check the sandbox (build)" step ran. Then "Verify the sandbox check" failed closed both times with `The sandbox check changed .git: config info`. No agent ran; nothing was pushed; AI-45 is flagged Needs you.

## Cause

- `check-git` (ADR-0071) compares `.git` with the copy taken in Prepare, before `claude-code-action` runs. The action (pinned d70510b) writes `.git` itself, outside the sandbox, before Claude starts: `git config user.name` / `user.email` and `git remote set-url origin https://x-access-token:<token>@github.com/<repo>.git` (`src/github/operations/git-config.ts`), and a `/.claude-pr/` line in `.git/info/exclude` (`restore-config.ts`). The check read those as tampering.
- Side finding: that remote URL puts the job's read-only `github.token` into `.git/config`, which sandboxed Bash can read (true since ADR-0063). Accepted: read-only on a public repo, network to the npm registry only, and it expires when the agent job ends, before the publish job opens a PR. Threat model R22.

## Fix (AI-47)

- `check-git` compares `config` through `git config --file - --list` (the bytes read once, no includes) without `user.name` and `user.email`, with the action's `x-access-token` userinfo and `.git` suffix stripped from `remote.origin.url` (so it must equal the checkout's URL), and `info/` without the `/.claude-pr/` exclude line. Any other change (e.g. `credential.helper`, `core.fsmonitor`, an `ext::` remote, another exclude line, an attributes file) still fails the job. Tests run the action's own git commands on a real repo.
- No new ADR: ADR-0071's design holds; this narrows what its check counts as a change.

## Third try (after AI-47, PR #89)

- **Run:** AI-45, build run `b0wCLX2buTQs4BgJhufk` (Actions run 42350657427). bubblewrap and `.git/config` passed; "Verify the sandbox check" failed closed with `The sandbox check changed .git: info`. No agent ran.
- **Cause:** something outside the sandbox (the action or Claude Code; the profile write-denies `.git/info` for sandboxed Bash) changed a file in `.git/info` beyond the allowed `/.claude-pr/` line; the message didn't say which. Reproducing it locally wasn't possible.
- **Fix (AI-48: Sandbox check fails on an unnamed change in .git/info):** `check-git` names the changed entries of a changed directory (names only), e.g. `info (attributes)`, and no longer compares `info/exclude` (a regular file or absent): it only lists ignored paths, can't make git run code or read another config, and the collect step uses the pre-agent `.git`. The rest of `info/` stays compared.

## Next

After the fix merges, re-run §9 on AI-45 and record the result here. If it fails again, the message names the path.
