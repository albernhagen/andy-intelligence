import { stat } from "node:fs/promises";
import { git } from "./git";

/**
 * A build agent's change as a binary patch (ADR-0089 slice 6), as the Actions executor's collect
 * step makes it: `git add -A` and `git diff --cached --binary` against the base commit, no
 * external diff or textconv, no renames. git runs with the worktree's own git directory, read
 * before the agent started, never through the checkout's `.git` file (the agent could rewrite
 * it); the git directory sits outside what the agent can write.
 */

export type ChangeResult =
  { kind: "none" } | { kind: "change"; bytes: number } | { kind: "error"; reason: string };

export async function collectChange(input: {
  checkout: string;
  gitDir: string;
  patchPath: string;
  maxBytes: number;
}): Promise<ChangeResult> {
  const env = { GIT_DIR: input.gitDir, GIT_WORK_TREE: input.checkout };
  const opts = ["-c", "core.untrackedCache=false"];
  try {
    await git([...opts, "add", "-A"], input.checkout, env);
    await git(
      [
        ...opts,
        "diff",
        "--cached",
        "--binary",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        `--output=${input.patchPath}`,
      ],
      input.checkout,
      env,
    );
  } catch {
    return { kind: "error", reason: "Couldn't collect the change (git failed)." };
  }
  const bytes = (await stat(input.patchPath)).size;
  if (bytes === 0) return { kind: "none" };
  if (bytes > input.maxBytes) {
    return {
      kind: "error",
      reason: `The change is ${bytes} bytes; the cap is ${input.maxBytes} (a missing .gitignore entry, e.g. node_modules?).`,
    };
  }
  return { kind: "change", bytes };
}
