#!/usr/bin/env node
// Decides whether the sandbox self-test runs (AI-63): reads NUL-separated changed paths on stdin
// (`git diff --name-only -z`) and prints `run=true` or `run=false` for $GITHUB_OUTPUT.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The paths that can change how the build sandbox behaves. */
const EXECUTOR_PATHS = [
  /^platform\/executor\//,
  /^platform\/actions\/sandbox-self-test\//,
  /^scripts\/executor-[^/]*\.mjs$/,
  /^scripts\/sandbox-lab\//,
  /^\.github\/workflows\/(claude-executor|agent-run|sandbox-self-test)\.yml$/,
];

/** True when any changed path is an executor path. */
export function touchesExecutor(paths) {
  return paths.some((p) => EXECUTOR_PATHS.some((re) => re.test(p)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = readFileSync(0, "utf8").split("\0").filter(Boolean);
  process.stdout.write(`run=${touchesExecutor(paths)}\n`);
}
