#!/usr/bin/env node
// Lockfile source check (ADR-0046): the review agents don't read lockfile diffs, so this
// deterministic check makes sure every locked package comes from the public npm registry with an
// integrity hash. It fails on tarball URLs, git or directory sources and other registries, which a
// lockfile-only edit could otherwise slip in.
//
// Usage: node scripts/lockfile-sources.mjs [repo-dir]. Checks pnpm-lock.yaml, package-lock.json
// and yarn.lock where present. Exit 1 on a non-registry source.
import { closeSync, openSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRIES = ["https://registry.npmjs.org/", "https://registry.yarnpkg.com/"];

/** @returns {string[]} offending lines, as `line N: text` */
export function pnpmOffenders(text) {
  return text.split("\n").flatMap((line, i) => {
    const m = line.match(/^\s*resolution:\s*(.*)$/);
    if (!m) return [];
    return /^\{integrity: [^,}]+\}$/.test(m[1].trim()) ? [] : [`line ${i + 1}: ${line.trim()}`];
  });
}

export function npmOffenders(text) {
  const offenders = [];
  const walk = (packages) => {
    for (const [name, pkg] of Object.entries(packages ?? {})) {
      if (pkg.link || name === "") continue;
      const ok =
        pkg.resolved && REGISTRIES.some((r) => pkg.resolved.startsWith(r)) && pkg.integrity;
      if (!ok) offenders.push(`${name}: ${pkg.resolved ?? "no resolved URL"}`);
    }
  };
  walk(JSON.parse(text).packages);
  return offenders;
}

export function yarnOffenders(text) {
  return text.split("\n").flatMap((line, i) => {
    const m = line.match(/^\s*resolved\s+"?([^"\s]+)"?/);
    if (!m) return [];
    return REGISTRIES.some((r) => m[1].startsWith(r)) ? [] : [`line ${i + 1}: ${line.trim()}`];
  });
}

const CHECKS = {
  "pnpm-lock.yaml": pnpmOffenders,
  "package-lock.json": npmOffenders,
  "yarn.lock": yarnOffenders,
};

/**
 * A lockfile's text, read through one descriptor; null when it doesn't exist. The build sandbox
 * binds empty, unreadable placeholders at package-lock.json and yarn.lock (AI-56): one that
 * can't be opened but is empty reads as "" (nothing to check); any other error is thrown.
 */
export function readLockfile(path) {
  let fd;
  try {
    fd = openSync(path, "r");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    if (err.code === "EACCES" && statSync(path).size === 0) return "";
    throw err;
  }
  try {
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? ".";
  let failed = false;
  for (const [file, check] of Object.entries(CHECKS)) {
    const path = join(dir, file);
    const text = readLockfile(path);
    if (text === null) continue;
    // An empty lockfile lists no packages.
    if (text === "") {
      process.stdout.write(`skip ${file}: empty\n`);
      continue;
    }
    const offenders = check(text);
    if (offenders.length === 0) {
      process.stdout.write(`ok   ${file}: every package from the npm registry with integrity\n`);
      continue;
    }
    failed = true;
    process.stdout.write(`FAIL ${file}: sources outside the npm registry\n`);
    for (const o of offenders.slice(0, 20)) process.stdout.write(`  ${o}\n`);
  }
  if (failed) process.exit(1);
}
