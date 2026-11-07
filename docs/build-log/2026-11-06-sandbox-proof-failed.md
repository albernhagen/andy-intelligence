# 2026-11-06 — Sandbox proof failed; fixed by AI-42: Build sandbox: every Bash call fails on .git/config.lock, and mount placeholders leak into the PR

## The proof (runbook `agent-runs.md` §9)

- **Run:** ticket AI-41: Sandbox probe script, control-plane run `K5NXGdoOc2ec9C6nzHye`, Actions run 42346386754, PR #87: Sandbox probe script (closed unmerged). Builds switched on for project `AI` by Andy for the proof, off again after it.
- **Seen:** the job logged "Sandbox ready: bubblewrap 0.9.0" and installed the managed `sandbox` block (`failIfUnavailable`, `allowUnsandboxedCommands: false`, network `registry.npmjs.org` only). Then every Bash call failed before starting: `bwrap: Can't create file at …/.git/config.lock: Read-only file system`. No checks and no probe ran; `permission_denials_count` 0. The publish job committed seven empty files the agent never wrote: `.gitmodules`, `.npmrc`, `.yarnrc`, `.yarnrc.yml`, `bunfig.toml`, `package-lock.json`, `yarn.lock` (flagged as tooling files, not stopped).
- **Not proven:** credentials unset, `sudo` failing, `example.com` blocked, the second chore's denied edit.

## Cause

- The profile's `filesystem.denyWrite: ["<checkout>/.git"]` bound `.git` read-only. Claude Code's sandbox holds a write denial on a missing protected file by binding a 0-byte read-only placeholder there; inside a read-only `.git` it couldn't create one at `.git/config.lock`, so the wrapper failed for every command.
- The seven files are those placeholders, for protected files the repo lacks. The sandbox is meant to remove them after each command; here they stayed.
- The smoke test ran plain `bwrap --ro-bind / / … true`, not Claude Code's wrapper, so it passed.

## Fix (AI-42, ADR-0071)

- **`.git` writable:** no `denyWrite` on `.git`. The sandbox's own protected paths keep `.git/config` and `.git/hooks` read-only (docs: "`hooks` and `config` inside `.git`"); the Edit tool keeps `.git/**` denied; collection already runs git from the pre-agent copy of `.git`.
- **Honest check:** "Check the sandbox (build)" runs the pinned `claude-code-action` once more before the agent, same managed settings and env, fixed prompt, Haiku, 3 turns, 5 minutes. One Bash call runs `git update-index --refresh` and `git status`, checks the credential variables are empty, and writes `sha256(nonce)` to the checkout; "Verify the sandbox check" compares it and fails the job before the agent runs if it is wrong. The `bwrap` call now only says it "can make its namespaces".
- **Placeholders:** the collect step runs `executor-publish.mjs drop-placeholders` before `git add -A`: listed protected files that are empty regular files, not symlinked, and absent from the manifest taken before the check are deleted and logged. Unit tests: a sandbox's empty `yarn.lock` and `.npmrc` aren't collected; a real `yarn.lock` is.
- **Refine questions on AI-42** were still open when this was built: `.git` follows option 1 through the sandbox's own protection (no extra deny for `.git/modules`: the repo has no submodules and `.gitmodules` is protected); placeholders use the manifest plus the list; a new ADR (0071).

## Next

After this merges and deploys, Andy repeats §9 (Builds on, Auto-build off, a new "Sandbox probe script" chore, then the `.github/` chore) and records the result here or in a new entry. Builds stays off until it passes.
