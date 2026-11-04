#!/usr/bin/env node
// Executor permission profile (ADR-0040, ARCHITECTURE §7.2): builds the Claude Code managed
// settings for one headless run from platform/executor/profile.json, the run's step and the
// project's CODEOWNERS. Every CODEOWNERS path becomes an `Edit` deny, so the agent can't change
// owned files; the workflow installs the result as /etc/claude-code/managed-settings.json.
//
// Usage: executor-profile.mjs --step <step> --out <file> [--codeowners <file>] [--root <dir>]
//        [--profile <profile.json>]
// --root is the project checkout (default: cwd); CODEOWNERS paths are anchored there.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const DEFAULT_PROFILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "platform",
  "executor",
  "profile.json",
);

/** CODEOWNERS patterns (gitignore-style) of lines that name at least one owner. */
export function codeownersPatterns(text) {
  const patterns = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    // Pattern = first run of non-whitespace, where `\ ` and `\#` are escapes.
    const match = line.match(/^((?:\\.|[^\s\\])+)(.*)$/);
    if (!match) continue;
    const owners = match[2].replace(/\s#.*$/, "").trim();
    // A pattern with no owners un-owns files; skipping it keeps the earlier, wider deny.
    if (owners === "") continue;
    patterns.push(match[1].replace(/\\(.)/g, "$1"));
  }
  return patterns;
}

/**
 * Converts one CODEOWNERS pattern to permission-rule paths anchored at `root` (absolute, as
 * `//abs/...`). Leading `/` or a slash in the middle = relative to the repo root; no slash = any
 * depth; trailing `/` = directory contents. A pattern that may name a directory also covers
 * everything under it.
 */
export function toRulePaths(pattern, root) {
  const anchor = `/${resolve(root)}`.replace(/\/+$/, "");
  let p = pattern;
  const isDir = p.endsWith("/");
  p = p.replace(/\/+$/, "");
  if (p === "" || p === "*" || p === "/*" || p === "**" || p === "/**") return [`${anchor}/**`];
  const anchored = p.startsWith("/") || p.includes("/");
  p = p.replace(/^\/+/, "");
  const body = anchored ? `${anchor}/${p}` : `${anchor}/**/${p}`;
  if (isDir) return [`${body}/**`];
  if (p.endsWith("/**") || p.endsWith("/*")) return [body];
  return [body, `${body}/**`];
}

/** Merges the base settings, the step's allow/deny rules and CODEOWNERS Edit denies. */
export function buildProfile({ profile, step, codeowners = "", root }) {
  const stepRules = Object.hasOwn(profile.steps, step) ? profile.steps[step] : null;
  if (!stepRules) throw new Error(`unknown step "${step}"`);
  const settings = JSON.parse(JSON.stringify(profile.settings));
  const ownedPaths = codeownersPatterns(codeowners).flatMap((p) => toRulePaths(p, root));
  const permissions = settings.permissions;
  permissions.allow = [...new Set([...(permissions.allow ?? []), ...stepRules.allow])];
  permissions.deny = [
    ...new Set([
      ...(permissions.deny ?? []),
      ...(stepRules.deny ?? []),
      ...ownedPaths.map((path) => `Edit(${path})`),
    ]),
  ];
  return settings;
}

function main() {
  const { values } = parseArgs({
    options: {
      step: { type: "string" },
      out: { type: "string" },
      codeowners: { type: "string" },
      root: { type: "string" },
      profile: { type: "string" },
    },
  });
  if (!values.step || !values.out) throw new Error("--step and --out are required");
  const profile = JSON.parse(readFileSync(values.profile ?? DEFAULT_PROFILE, "utf8"));
  const codeowners =
    values.codeowners && existsSync(values.codeowners)
      ? readFileSync(values.codeowners, "utf8")
      : "";
  const settings = buildProfile({
    profile,
    step: values.step,
    codeowners,
    root: values.root ?? process.cwd(),
  });
  writeFileSync(values.out, `${JSON.stringify(settings, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`executor-profile: ${error.message}\n`);
    process.exitCode = 1;
  }
}
