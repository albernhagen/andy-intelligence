#!/usr/bin/env node
// Root `postinstall` (AI-409). In this repo: generate the barrel exports (gen-exports.mjs) and
// install the git hooks (lefthook, ADR-0027). Installed as a package (`npx
// github:albernhagen/andy-intelligence`, which ships only the baseline CLI): nothing to do. It
// isn't a `prepare` script on purpose: npm installs every devDependency before running a git
// package's `prepare`, which made `npx` slow.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(join(ROOT, "pnpm-workspace.yaml"))) process.exit(0);

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(process.execPath, [join(ROOT, "scripts/gen-exports.mjs")]);
if (existsSync(join(ROOT, ".git"))) run("pnpm", ["exec", "lefthook", "install"]);
