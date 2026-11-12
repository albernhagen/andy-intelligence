#!/usr/bin/env node
// Decides whether agent evals run (AI-6): reads NUL-separated changed paths on stdin
// (`git diff --name-only -z`) and prints `run=true` or `run=false` for $GITHUB_OUTPUT.
// `--machinery` also counts changes to the eval runner itself (the stub plumbing job).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AGENT_CONFIG_PATHS, EVAL_MACHINERY_PATHS } from "./config.mjs";

/** True when any changed path is agent configuration (or, with `machinery`, the eval runner). */
export function needsEvals(paths, { machinery = false } = {}) {
  const patterns = machinery
    ? [...AGENT_CONFIG_PATHS, ...EVAL_MACHINERY_PATHS]
    : AGENT_CONFIG_PATHS;
  return paths.some((p) => patterns.some((re) => re.test(p)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = readFileSync(0, "utf8").split("\0").filter(Boolean);
  const machinery = process.argv.includes("--machinery");
  process.stdout.write(`run=${needsEvals(paths, { machinery })}\n`);
}
