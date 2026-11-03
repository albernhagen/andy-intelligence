#!/usr/bin/env node
// Dependabot auto-merge decision (ADR-0042). Patch and minor npm and GitHub Actions updates get
// auto-merge (squash) once every required check passes; majors, Terraform providers and anything
// else wait for Andy. Grouped PRs report their highest semver change, so one major in a group
// keeps the whole PR manual.
//
// Env (dependabot/fetch-metadata outputs): ECOSYSTEM (package-ecosystem), UPDATE_TYPE (update-type).
// Writes `merge=true|false` to $GITHUB_OUTPUT and logs the reason.
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ECOSYSTEMS = ["npm_and_yarn", "github_actions"];
export const UPDATE_TYPES = ["version-update:semver-patch", "version-update:semver-minor"];

/** @returns {{ merge: boolean, reason: string }} */
export function decide({ ecosystem, updateType }) {
  if (!ECOSYSTEMS.includes(ecosystem)) {
    return { merge: false, reason: `ecosystem "${ecosystem || "unknown"}" is merged by hand` };
  }
  if (!UPDATE_TYPES.includes(updateType)) {
    return { merge: false, reason: `update type "${updateType || "unknown"}" is merged by hand` };
  }
  return {
    merge: true,
    reason: `${ecosystem} ${updateType}: auto-merge once required checks pass`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { merge, reason } = decide({
    ecosystem: process.env.ECOSYSTEM,
    updateType: process.env.UPDATE_TYPE,
  });
  process.stdout.write(`${reason}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `merge=${merge}\n`);
}
