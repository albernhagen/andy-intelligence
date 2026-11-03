#!/usr/bin/env node
// Dependabot auto-merge decision (ADR-0042). npm updates where every dependency in the
// PR is a patch, or a minor of a package at 1.0 or later, get auto-merge (squash) once every
// required check passes. Everything else waits for Andy: majors, 0.x minors (breaking by
// convention), GitHub Actions (they run with tokens, OIDC and secrets, and pin the review
// workflows themselves), Terraform providers, and any PR whose metadata can't be read.
//
// Env (dependabot/fetch-metadata outputs): ECOSYSTEM (package-ecosystem), DEPENDENCIES
// (updated-dependencies-json). Writes `merge=true|false` to $GITHUB_OUTPUT and logs the reason.
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ECOSYSTEMS = ["npm_and_yarn"];
const PATCH = "version-update:semver-patch";
const MINOR = "version-update:semver-minor";

const manual = (reason) => ({ merge: false, reason: `${reason}: merged by hand` });

/** Why one dependency needs Andy, or null when it may auto-merge. */
function blocker({ dependencyName, updateType, prevVersion }) {
  const name = dependencyName || "unknown dependency";
  if (updateType === PATCH) return null;
  if (updateType !== MINOR) return `${name} is "${updateType || "unknown"}"`;
  const major = Number.parseInt(String(prevVersion ?? "").replace(/^v/, ""), 10);
  if (!Number.isInteger(major)) return `${name} has no previous version`;
  if (major === 0) return `${name} is a 0.x minor (${prevVersion})`;
  return null;
}

/** @returns {{ merge: boolean, reason: string }} */
export function decide({ ecosystem, dependencies }) {
  if (!ECOSYSTEMS.includes(ecosystem)) {
    return manual(`ecosystem "${ecosystem || "unknown"}"`);
  }
  let deps;
  try {
    deps = JSON.parse(dependencies ?? "");
  } catch {
    return manual("dependency list unreadable");
  }
  if (!Array.isArray(deps) || deps.length === 0) return manual("no dependencies listed");
  const reasons = deps.map(blocker).filter(Boolean);
  if (reasons.length > 0) return manual(reasons.join("; "));
  return {
    merge: true,
    reason: `${deps.length} npm patch/minor update(s): auto-merge once required checks pass`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { merge, reason } = decide({
    ecosystem: process.env.ECOSYSTEM,
    dependencies: process.env.DEPENDENCIES,
  });
  process.stdout.write(`${reason}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `merge=${merge}\n`);
}
