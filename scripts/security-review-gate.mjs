#!/usr/bin/env node
// Security-review gate (ADR-0025, ADR-0030): turns the reviewer agent's structured findings
// into a pass/fail decision and the PR comment body. Findings come from an agent that read
// untrusted PR content, so every field is sanitized before it reaches the comment.
//
// Env: MODE (review | unavailable | fork), ACCEPTED ("true" when the security-accepted label
// is on the PR), FINDINGS (the agent's JSON), REASON (why the agent didn't run), SHA,
// EXECUTION_FILE (the action's message log; its result message gives usage, ADR-0030).
// Writes the comment body to the path in argv[2]; exit code 1 means the check fails.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MARKER = "<!-- security-review -->";
export const LABEL = "security-accepted";
export const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const BLOCKING = new Set(["critical", "high"]);
const MAX_FIELD = 500;

/** Makes agent-written text safe for a Markdown table cell: no HTML, mentions, pipes or newlines. */
export function sanitize(value) {
  const text = String(value ?? "")
    .replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"))
    .replace(/@/g, "@​")
    .replace(/[\\|]/g, "\\$&")
    .replace(/\s*\r?\n\s*/g, " ")
    .trim();
  return text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD)}…` : text;
}

/** Parses the agent's JSON; returns null when it is missing or not the expected shape. */
export function parseFindings(raw) {
  let data;
  try {
    data = JSON.parse(raw ?? "");
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || !Array.isArray(data.findings)) return null;
  const findings = data.findings.filter(
    (f) => typeof f === "object" && f !== null && SEVERITIES.includes(f.severity),
  );
  if (findings.length !== data.findings.length) return null;
  return { summary: typeof data.summary === "string" ? data.summary : "", findings };
}

/** One line of run usage from the action's execution file messages, or "" when absent. */
export function usageLine(messages) {
  const result = Array.isArray(messages) ? messages.findLast((m) => m?.type === "result") : null;
  if (!result) return "";
  const parts = [];
  if (Number.isFinite(result.num_turns)) parts.push(`${result.num_turns} turns`);
  const { input_tokens: input, output_tokens: output } = result.usage ?? {};
  const cached =
    (result.usage?.cache_read_input_tokens ?? 0) + (result.usage?.cache_creation_input_tokens ?? 0);
  if (Number.isFinite(input) && Number.isFinite(output)) {
    parts.push(
      `${(input + cached).toLocaleString("en-US")} input / ${output.toLocaleString("en-US")} output tokens`,
    );
  }
  if (Number.isFinite(result.total_cost_usd)) {
    parts.push(
      `≈ $${result.total_cost_usd.toFixed(2)} API-equivalent (estimate; billed to the subscription)`,
    );
  }
  return parts.length > 0 ? `Usage: ${parts.join(", ")}.` : "";
}

function findingsTable(findings) {
  const sorted = [...findings].sort(
    (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity),
  );
  const rows = sorted.map((f) => {
    const where = f.file
      ? `\`${sanitize(f.file)}${f.line ? `:${Number(f.line) || ""}` : ""}\``
      : "";
    return `| ${f.severity} | ${sanitize(f.title)} | ${where} | ${sanitize(f.description)} | ${sanitize(f.recommendation)} |`;
  });
  return ["| Severity | Finding | Where | Why | Fix |", "|---|---|---|---|---|", ...rows].join(
    "\n",
  );
}

/** Decides whether the check passes and builds the PR comment. */
export function evaluate({ mode, accepted, findings: raw, reason, sha, usage = "" }) {
  const footer = `\n\n<sub>${usage ? `${usage} ` : ""}Commit ${sanitize(sha) || "unknown"}. Rules: \`platform/procedures/security-review.md\`. Override: Andy adds the \`${LABEL}\` label and writes why in the PR; it is removed on the next push.</sub>`;

  if (mode === "fork") {
    return {
      pass: accepted,
      body: `${MARKER}\n### Security review: not run (fork PR)\n\nForks get no secrets and the agent never runs on them. Andy reviews by hand; \`${LABEL}\` passes the check.${footer}`,
    };
  }

  const parsed = mode === "review" ? parseFindings(raw) : null;
  if (parsed === null) {
    const why = mode === "review" ? "the agent returned no valid findings" : sanitize(reason);
    return {
      pass: true,
      body: `${MARKER}\n### ⚠️ Security review: not reviewed\n\nThe agent didn't run: ${why || "unknown reason"}. The check is neutral (passes); Andy decides.${footer}`,
    };
  }

  const blocking = parsed.findings.filter((f) => BLOCKING.has(f.severity));
  const counts = SEVERITIES.map(
    (s) => `${s} ${parsed.findings.filter((f) => f.severity === s).length}`,
  ).join(" · ");
  let verdict;
  if (blocking.length === 0) verdict = "✅ Security review: no high/critical findings";
  else if (accepted)
    verdict = `⚠️ Security review: ${blocking.length} high/critical, accepted by \`${LABEL}\``;
  else
    verdict = `❌ Security review: ${blocking.length} high/critical — fix or ask Andy for \`${LABEL}\``;

  const table = parsed.findings.length > 0 ? `\n\n${findingsTable(parsed.findings)}` : "";
  const summary = parsed.summary ? `\n\n${sanitize(parsed.summary)}` : "";
  return {
    pass: blocking.length === 0 || accepted,
    body: `${MARKER}\n### ${verdict}\n\n${counts}${summary}${table}${footer}`,
  };
}

function readExecutionFile(path) {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const result = evaluate({
    mode: process.env.MODE,
    accepted: process.env.ACCEPTED === "true",
    findings: process.env.FINDINGS,
    reason: process.env.REASON,
    sha: process.env.SHA,
    usage: usageLine(readExecutionFile(process.env.EXECUTION_FILE)),
  });
  writeFileSync(process.argv[2], result.body);
  process.stdout.write(`${result.body}\n`);
  return result.pass ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
