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

## Fourth try (after AI-48, PR #90)

- **Run:** AI-45 reached its cap of 4 build runs, so a new chore AI-49: Sandbox probe script (second chore) took over; build run `l0BVuy7PV1oKkAHhSK1h` (Actions run 42351361214).
- **Passed, live for the first time:** the `.git` comparison, and every `verify-check` assertion: the exact command as the one Bash call (no error, no other tool), the nonce reaching it through env only, PID 1 not the runner's (own PID namespace), no credential variable names in `env`.
- **Failed:** the clean-checkout check: `The sandbox check left the checkout changed: .gitmodules .npmrc .yarnrc .yarnrc.yml bunfig.toml package-lock.json yarn.lock`. Claude Code 2.1.312 leaves its empty placeholders after a normal exit too, not only when killed as its docs say.
- **Fix (AI-50: Sandbox check fails on the placeholders the sandbox leaves in the checkout):** the verify step runs `executor-publish.mjs drop-placeholders` (listed, empty, regular, new since the manifest; each logged) before the clean-checkout check; anything else still fails. During the agent run the sandbox recreates them; pnpm ignores empty npm and yarn lockfiles and an empty `.npmrc`, and the collect step drops them again.

## Fifth try (after AI-50, PR #91)

- **Run:** AI-49, build run `Lyo8l6e9Nzr4aUzy6vTu` (Actions run 42387853332), probe PR #92 (closed unmerged). All four jobs succeeded.
- **Proven live:** the sandbox check passed; the seven placeholders were dropped and logged; the agent ran inside the sandbox (7 turns, 0 permission denials) and wrote `scripts/sandbox-probe.mjs`; collection dropped the placeholders again and the PR changed only that file. Probe output: `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN` not set; `/proc/1/cmdline` the sandbox's own shell; `sudo -n true` failed (exit 1); `curl https://example.com` failed (exit 56, proxy).
- **Failed:** `curl https://registry.npmjs.org` exit 77 (can't read CA certificates), and `pnpm: command not found`, so the project's checks didn't run. The `.github/` denial chore wasn't started (§9: stop after a failed expectation).
- **Cause:** Claude Code adds `Read` deny rules to the sandbox's `denyRead`, so the profile's `Read(//etc/**)` hid `/etc/ssl`; `blockReadsOutsideWorkingDirectories` hides `/home` from sandboxed commands, and pnpm was in `~/setup-pnpm`.
- **Fix (AI-51: Build sandbox: no CA certificates and no pnpm for sandboxed commands):** sandbox `filesystem.allowRead` `/etc/ssl/certs`, `/etc/ssl/openssl.cnf` and `/etc/ca-certificates`, not `/etc/ssl/private` (narrower than the `/etc` deny, so it wins for sandboxed commands; the Read tool keeps `Read(//etc/**)`); `pnpm/action-setup` `dest` in the runner's tool cache (readable, not writable, in the sandbox); pnpm's cache and state dirs under `/tmp/agent` like its store (checked locally with pnpm 10.28.0: a `pnpm install` with `npm_config_cache_dir` and `npm_config_state_dir` wrote its metadata cache and state there).

## Sixth try and a diagnostic (after AI-51, PR #93)

- **Run:** AI-52: Sandbox probe script (third chore), build run `QBMjeWXF7FHNg74MRJZq` (Actions run 42393177078), probe PR #94 (closed unmerged).
- **Every sandbox expectation held:** the three credential variables not set; `/proc/1/cmdline` the sandbox's own shell; `sudo -n true` fails ("no new privileges"); `curl https://example.com` fails (CONNECT 403); `curl https://registry.npmjs.org` succeeds.
- **Failed:** `pnpm install --frozen-lockfile` downloaded the packages, then failed with `EROFS` writing `node_modules/.bin/eslint`; no checks ran.
- **Diagnostic:** AI-53: Sandbox diagnostic: which mount makes node_modules/.bin read-only (build run `QBPqyF3j9fAJNjZQwp0s`, PR #95, closed unmerged): `node_modules` and `node_modules/.bin` are their own read-only bind mounts (mountinfo 578, 628), like `package.json` and the lockfiles; the repo root is writable. No profile rule covers them: Claude Code's own protected package-manager paths.
- **Fix (AI-54: Build sandbox: pre-install dependencies before the agent (node_modules is read-only inside), ADR-0072, decided by Andy):** "Install dependencies (build)" runs `pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile` outside the sandbox before the agent, store under runner temp; the build procedure says dependencies are installed and can't be changed.

## Next

After the fix merges, start a new probe chore and record the result here; then the `.github/` denial chore.
