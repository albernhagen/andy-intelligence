# 2026-11-04 — Context-budget test no longer overwrites the git index (AI-20)

- **Symptom:** after every `git push` from a git worktree, the index held three files and every other tracked file showed as staged for deletion. `git reset` restored it.
- **Cause:** the pre-push hook (lefthook) runs `pnpm test` with git's `GIT_*` variables set (`GIT_DIR`, `GIT_INDEX_FILE`, …). `scripts/context-budget.test.mjs` ran `git init` and `git add -A` in a temp directory, inherited them, and wrote the temp files into the real repository's index.
- **Fix:** `scripts/git-env.mjs` `cleanGitEnv()` returns the environment without any `GIT_*` variable. The context-budget test's temp-repo helper and CLI runs use it, and so does `platform/baseline/baseline.mjs` for every command on its cloned repo. A regression test runs the helper with `GIT_DIR` / `GIT_INDEX_FILE` pointing at a throwaway repository and checks its index is unchanged.
- **Checked:** no other test or script under `scripts/`, `platform/` or `packages/` spawns git to create or write a repository.
