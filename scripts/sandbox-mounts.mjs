#!/usr/bin/env node
// Sandbox diagnostic (AI-53): which mount makes node_modules/.bin read-only. Read-only: prints
// the failing paths from a `pnpm install` log, `ls -ld` and `findmnt` for key directories, the
// mountinfo lines inside the repo, and uid/umask. Never prints environment variable values.
//
// Usage: node scripts/sandbox-mounts.mjs [install-log-file]   (or pipe the log on stdin)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trimEnd();
  const status = r.error ? `error: ${r.error.message}` : `exit ${r.status}`;
  return `$ ${cmd} ${args.join(" ")}\n${out}${out ? "\n" : ""}[${status}]`;
}

function readLog() {
  const file = process.argv[2];
  if (file) return existsSync(file) ? readFileSync(file, "utf8") : "";
  if (process.stdin.isTTY) return "";
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Absolute paths in pnpm's error output that follow an error code like EROFS. */
export function failingFiles(log) {
  const found = new Set();
  for (const line of log.split("\n")) {
    if (!/\b(EROFS|EACCES|EPERM|ENOENT)\b/.test(line)) continue;
    for (const m of line.matchAll(/(\/[^\s'"`,]+)/g)) found.add(m[1]);
  }
  return [...found];
}

/** mountinfo lines whose mount point (field 5) is inside `dir`. */
export function mountsInside(mountinfo, dir) {
  return mountinfo.split("\n").filter((line) => {
    const mp = line.split(" ")[4];
    return mp && (mp === dir || mp.startsWith(`${dir}/`));
  });
}

function main() {
  const log = readLog();
  const files = failingFiles(log);
  console.log("== Failing files (from install log) ==");
  console.log(files.length ? files.join("\n") : "(none found)");

  const dirs = [
    root,
    join(root, "node_modules"),
    join(root, "node_modules", ".bin"),
    ...files.map((f) => dirname(f)),
  ];
  console.log("\n== Directories ==");
  for (const dir of new Set(dirs)) {
    console.log(`\n-- ${dir}`);
    console.log(run("ls", ["-ld", dir]));
    console.log(run("findmnt", ["-T", dir, "-o", "TARGET,SOURCE,OPTIONS"]));
  }

  console.log(`\n== /proc/self/mountinfo lines inside ${root} ==`);
  try {
    const lines = mountsInside(readFileSync("/proc/self/mountinfo", "utf8"), root);
    console.log(lines.length ? lines.join("\n") : "(none)");
  } catch (e) {
    console.log(`error: ${e.message}`);
  }

  console.log("\n== Identity ==");
  console.log(run("id", ["-u"]));
  console.log(run("sh", ["-c", "umask"]));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
