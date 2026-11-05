/**
 * `env` without any `GIT_*` variable. Git hooks export GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE and
 * others; a git command that creates or writes a separate repository must not inherit them, or it
 * writes to the hook's repository instead (AI-20).
 */
export function cleanGitEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("GIT_")));
}
