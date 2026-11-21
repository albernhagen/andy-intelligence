#!/usr/bin/env node
// Release-note check (AI-159, ADR-0121): a PR into the default branch must carry the release-note
// block ("What changed:", "How it works:", optional "Needs you:") within its word caps. The parser
// is the domain's own (`packages/domain/src/release-note.ts`), imported with Node's type
// stripping, so the check and the control plane read the block the same way.
//
// Reads the PR from the event file ($GITHUB_EVENT_PATH), never from an interpolated expression:
// the description is untrusted text. Dependabot PRs and PRs into other branches are skipped.
// Exits 1 with one line per problem.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseReleaseNote } from "../packages/domain/src/release-note.ts";

/** Authors whose PRs never carry a note (their merges are listed by title, as "no note"). */
export const SKIPPED_AUTHORS = ["dependabot[bot]"];

/** @returns {{ ok: boolean, lines: string[] }} */
export function check(event) {
  const pr = event?.pull_request;
  if (!pr) return { ok: true, lines: ["Not a pull request: nothing to check."] };
  if (SKIPPED_AUTHORS.includes(pr.user?.login)) {
    return { ok: true, lines: [`Skipped: PRs by ${pr.user.login} carry no release note.`] };
  }
  const defaultBranch = event.repository?.default_branch;
  if (defaultBranch && pr.base?.ref !== defaultBranch) {
    return { ok: true, lines: [`Skipped: this PR targets ${pr.base?.ref}, not ${defaultBranch}.`] };
  }
  const { problems } = parseReleaseNote(pr.body ?? "");
  if (problems.length === 0) return { ok: true, lines: ["Release note: OK."] };
  return {
    ok: false,
    lines: [
      "Release note (AI-159): fix the block in the PR description, then edit it to re-run.",
      ...problems.map((p) => `- ${p}`),
      'Format: "What changed:" (≤25 words), "How it works:" (≤45), optional "Needs you:" (≤25).',
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.env.GITHUB_EVENT_PATH;
  const event = path ? JSON.parse(readFileSync(path, "utf8")) : null;
  const { ok, lines } = check(event);
  for (const line of lines) process.stdout.write(`${ok ? "" : "::error::"}${line}\n`);
  process.exitCode = ok ? 0 : 1;
}
