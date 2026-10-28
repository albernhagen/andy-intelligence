#!/usr/bin/env node
// Claude Code PostToolUse hook (ADR-0027): formats and lints the file an agent just edited.
// Reads the hook payload from stdin. Exit 2 sends stderr back to the agent so it fixes
// lint errors that `eslint --fix` can't.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LINTABLE = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);

/** Returns the edited file's absolute path, or null when there is nothing to format. */
export function editedFile(payload, projectDir) {
  const filePath = payload?.tool_input?.file_path;
  if (typeof filePath !== "string" || filePath === "") return null;
  const absolute = path.resolve(projectDir, filePath);
  const relative = path.relative(projectDir, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (relative.split(path.sep).includes("node_modules")) return null;
  return absolute;
}

/** The commands to run on a file, in order. */
export function commandsFor(file) {
  const commands = [["prettier", ["--write", "--ignore-unknown", file]]];
  if (LINTABLE.has(path.extname(file))) {
    commands.push(["eslint", ["--fix", "--no-warn-ignored", file]]);
  }
  return commands;
}

function main() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const file = editedFile(JSON.parse(readFileSync(0, "utf8")), projectDir);
  if (file === null || !existsSync(file)) return 0;

  for (const [tool, args] of commandsFor(file)) {
    const bin = path.join(projectDir, "node_modules", ".bin", tool);
    if (!existsSync(bin)) {
      process.stderr.write(`format hook: ${tool} not installed; run pnpm install\n`);
      return 0;
    }
    const result = spawnSync(bin, args, { cwd: projectDir, encoding: "utf8" });
    if (result.status !== 0) {
      process.stderr.write(`${tool} failed on ${path.relative(projectDir, file)}:\n`);
      process.stderr.write(result.stdout + result.stderr);
      return 2;
    }
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
