#!/usr/bin/env node
// Executor publish helpers (ADR-0063): the build run's `publish` job checks the agent's change
// before it pushes, and writes the pull request's title and description. The change and the
// agent's output are untrusted: this script only reads them, never runs them.
//
// Usage:
//   executor-publish.mjs check --profile <profile.json> --codeowners <file> --raw <file>
//     <file> holds `git diff --cached --raw -z --no-renames` of the applied change. Exits 1 with
//     the reasons when the change touches a protected path, a symlink or submodule, or is too big.
//   executor-publish.mjs pr
//     Env: CONTROL_PLANE_URL, PROJECT_ID, TICKET_KEY, TICKET_TITLE, RUN_ID, MODEL, BRANCH, REPORT
//     (the agent's report JSON). Prints {"title","body"} JSON.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { codeownersPatterns } from "./executor-profile.mjs";

/** Caps on one build run's change (ADR-0028). */
export const MAX_CHANGED_FILES = 200;
/** GitHub rejects descriptions over 65,536 characters. */
export const MAX_BODY = 60000;

/**
 * Protected path globs (repo-relative): every any-depth Edit deny of the profile (rules like Edit of //, two stars, /x), and every
 * CODEOWNERS pattern after the catch-all `*` line (ARCHITECTURE §4.5: paths listed after `*` are
 * the protected ones; `*` itself only requests Andy's review).
 */
export function protectedGlobs(profile, codeowners) {
  const fromProfile = profile.settings.permissions.deny
    .map((rule) => /^Edit\(\/\/\*\*\/(.+)\)$/.exec(rule)?.[1])
    .filter((p) => p !== undefined)
    .map((p) => `**/${p}`);
  const fromOwners = codeownersPatterns(codeowners)
    .filter((p) => !["*", "/*", "**", "/**"].includes(p))
    .flatMap((p) => {
      const dir = p.endsWith("/");
      const body = p.replace(/^\/+|\/+$/g, "");
      const anchored = p.replace(/\/+$/, "").includes("/");
      const glob = anchored ? body : `**/${body}`;
      return dir || glob.endsWith("/**")
        ? [`${glob.replace(/\/\*\*$/, "")}/**`]
        : [glob, `${glob}/**`];
    });
  return [...new Set([...fromProfile, ...fromOwners])];
}

/** A gitignore-style glob as a regex over repo-relative paths: double-star slash = any dirs, `*` within one. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (glob.startsWith("**/", i)) {
      re += "(?:.*/)?";
      i += 2;
    } else if (glob.startsWith("**", i)) {
      re += ".*";
      i += 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Entries of `git diff --raw -z --no-renames`: { srcMode, dstMode, status, path }. */
export function parseRaw(text) {
  const parts = text.split("\0").filter((p) => p !== "");
  const entries = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [srcMode, dstMode, , , status] = parts[i].replace(/^:/, "").split(" ");
    entries.push({ srcMode, dstMode, status, path: parts[i + 1] });
  }
  return entries;
}

/** Reasons the change can't be pushed; empty when it can. */
export function checkChange(entries, globs) {
  const reasons = [];
  if (entries.length === 0) reasons.push("the change is empty");
  if (entries.length > MAX_CHANGED_FILES) {
    reasons.push(`${entries.length} files changed; the cap is ${MAX_CHANGED_FILES}`);
  }
  const patterns = globs.map((g) => [g, globToRegExp(g)]);
  for (const e of entries) {
    if (e.dstMode === "120000" || e.srcMode === "120000") reasons.push(`${e.path}: a symlink`);
    if (e.dstMode === "160000" || e.srcMode === "160000") reasons.push(`${e.path}: a submodule`);
    const hit = patterns.find(([, re]) => re.test(e.path));
    if (hit) reasons.push(`${e.path}: protected (${hit[0]})`);
  }
  return reasons;
}

/** Zero-width space: breaks @-mentions and code fences without changing how text reads. */
const ZWSP = "\u200b";

/** Untrusted text made safe to paste into markdown: no @-mentions, no fence breaks. */
export function neutralize(text) {
  return String(text)
    .replace(/@(?=[A-Za-z0-9])/g, `@${ZWSP}`)
    .replace(/`{3,}|~{3,}/g, (m) => m.split("").join(ZWSP));
}

const list = (items) =>
  items.length === 0 ? "None." : items.map((i) => `- ${neutralize(i)}`).join("\n");

/** The PR title and description: the ticket link first, then the structured summary (§4.1). */
export function pullRequest({
  controlPlaneUrl,
  projectId,
  ticketKey,
  ticketTitle,
  runId,
  model,
  report,
}) {
  const title = `${ticketKey}: ${ticketTitle}`.replace(/[\r\n]+/g, " ").slice(0, 250);
  const output = report?.output ?? null;
  const lines = [
    `${controlPlaneUrl}/p/${projectId}/t/${ticketKey}`,
    "",
    `**Ticket:** ${ticketKey} · **Run:** \`${runId}\` · **Model:** ${model} · **Opened by** the build run (ADR-0063); agent text below is untrusted.`,
    "",
    "## Summary",
    "",
    neutralize(output?.summary ?? report?.summary ?? "The run gave no summary."),
  ];
  if (output) {
    const p = output.plan;
    lines.push(
      "",
      "## Plan",
      "",
      "**Files**",
      list(p.files),
      "",
      "**Order of work**",
      p.steps.map((s, i) => `${i + 1}. ${neutralize(s)}`).join("\n"),
      "",
      "**Tests**",
      list(p.tests),
      "",
      `**Riskiest step:** ${neutralize(p.riskiestStep)}`,
      "",
      "**Rejected alternatives**",
      list(p.rejectedAlternatives),
      "",
      "## Deviations from the plan",
      "",
      list(output.deviations),
      "",
      "## Verification",
      "",
      ...output.verification.flatMap((c) => [
        `- \`${neutralize(c.command).replace(/`/g, "'")}\`: ${c.passed ? "passed" : "**failed**"}`,
        ...(c.output
          ? ["", "  ````text", neutralize(c.output).replace(/^/gm, "  "), "  ````", ""]
          : []),
      ]),
    );
    if (output.failingTestFiles.length > 0) {
      lines.push("", "## Failing test first (bug)", "", list(output.failingTestFiles));
    }
  } else {
    lines.push("", "## Verification", "", "None: the run returned no structured result.");
  }
  let body = lines.join("\n");
  if (body.length > MAX_BODY) body = `${body.slice(0, MAX_BODY - 40)}\n\n…(cut to the size limit)`;
  return { title, body };
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "check") {
    const { values } = parseArgs({
      args: rest,
      options: {
        profile: { type: "string" },
        codeowners: { type: "string" },
        raw: { type: "string" },
      },
    });
    const profile = JSON.parse(readFileSync(values.profile, "utf8"));
    let owners;
    try {
      owners = values.codeowners ? readFileSync(values.codeowners, "utf8") : "";
    } catch {
      owners = "";
    }
    const reasons = checkChange(
      parseRaw(readFileSync(values.raw, "utf8")),
      protectedGlobs(profile, owners),
    );
    for (const r of reasons) process.stdout.write(`::error title=claude-executor::${r}\n`);
    process.exitCode = reasons.length === 0 ? 0 : 1;
    return;
  }
  if (command === "pr") {
    const env = process.env;
    let report;
    try {
      report = JSON.parse(env.REPORT ?? "null");
    } catch {
      report = null;
    }
    const pr = pullRequest({
      controlPlaneUrl: env.CONTROL_PLANE_URL,
      projectId: env.PROJECT_ID,
      ticketKey: env.TICKET_KEY,
      ticketTitle: env.TICKET_TITLE,
      runId: env.RUN_ID,
      model: env.MODEL,
      report,
    });
    process.stdout.write(`${JSON.stringify(pr)}\n`);
    return;
  }
  throw new Error("usage: executor-publish.mjs check|pr");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`executor-publish: ${error.message}\n`);
    process.exitCode = 1;
  }
}
