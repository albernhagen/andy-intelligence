#!/usr/bin/env node
// Review gate for the PR review agents (ADR-0025, ADR-0026, ADR-0030, ADR-0037): turns an
// agent's structured findings into a pass/fail decision and the sticky PR comment. Findings
// come from an agent that read untrusted PR content, so every field is sanitized before it
// reaches the comment. One config per role; the plumbing is shared.
//
// Env: ROLE (security | adversarial), MODE (review | unavailable | fork), ACCEPTED ("true" when
// the role's override label is on the PR), FINDINGS (the agent's JSON), REASON (why the agent
// didn't run), SHA, EXECUTION_FILE (the action's message log; its result message gives usage).
// Writes the comment body to the path in argv[2]; exit code 1 means the check fails.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ROLES = {
  security: {
    marker: "<!-- security-review -->",
    title: "Security review",
    label: "security-accepted",
    severities: ["critical", "high", "medium", "low", "info"],
    blocking: ["critical", "high"],
    blockingName: "high/critical",
    detail: { field: "description", heading: "Why" },
    procedure: "platform/procedures/security-review.md",
  },
  adversarial: {
    marker: "<!-- adversarial-review -->",
    title: "Adversarial review",
    label: "review-accepted",
    severities: ["blocker", "should-fix", "question"],
    blocking: ["blocker"],
    blockingName: "blocker",
    detail: { field: "scenario", heading: "Failing scenario" },
    procedure: "platform/procedures/adversarial-review.md",
  },
};

/** Kept for callers of the M1.10 gate. */
export const MARKER = ROLES.security.marker;
export const LABEL = ROLES.security.label;
export const SEVERITIES = ROLES.security.severities;

/** Hidden marker with the PR head this comment reviewed; the next run diffs from it. */
export const reviewedShaMarker = (sha) => `<!-- reviewed-sha: ${sha} -->`;

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
export function parseFindings(raw, role = ROLES.security) {
  let data;
  try {
    data = JSON.parse(raw ?? "");
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || !Array.isArray(data.findings)) return null;
  const findings = data.findings.filter(
    (f) => typeof f === "object" && f !== null && role.severities.includes(f.severity),
  );
  if (findings.length !== data.findings.length) return null;
  const resolved = Array.isArray(data.resolved)
    ? data.resolved.filter((r) => typeof r === "string")
    : [];
  return { summary: typeof data.summary === "string" ? data.summary : "", findings, resolved };
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
      `≈ $${result.total_cost_usd.toFixed(2)} API-equivalent (estimate; uses subscription quota, not billed)`,
    );
  }
  return parts.length > 0 ? `Usage: ${parts.join(", ")}.` : "";
}

function findingsTable(findings, role) {
  const sorted = [...findings].sort(
    (a, b) => role.severities.indexOf(a.severity) - role.severities.indexOf(b.severity),
  );
  const rows = sorted.map((f) => {
    const where = f.file
      ? `\`${sanitize(f.file)}${f.line ? `:${Number(f.line) || ""}` : ""}\``
      : "";
    return `| ${f.severity} | ${sanitize(f.title)} | ${where} | ${sanitize(f[role.detail.field])} | ${sanitize(f.recommendation)} |`;
  });
  return [
    `| Severity | Finding | Where | ${role.detail.heading} | Fix |`,
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

/** Decides whether the check passes and builds the PR comment. */
export function evaluate({
  role: roleKey = "security",
  mode,
  accepted,
  findings: raw,
  reason,
  sha,
  usage = "",
}) {
  const role = ROLES[roleKey];
  if (!role) throw new Error(`unknown review role: ${roleKey}`);
  const safeSha = sanitize(sha) || "unknown";
  const footer = `\n\n<sub>${usage ? `${usage} ` : ""}Commit ${safeSha}. Rules: \`${role.procedure}\`. Override: Andy adds the \`${role.label}\` label and writes why in the PR; it is removed on the next push.</sub>`;
  const head = `${role.marker}\n${reviewedShaMarker(safeSha)}\n`;

  if (mode === "fork") {
    return {
      pass: accepted,
      body: `${head}### ${role.title}: not run (fork PR)\n\nForks get no secrets and the agent never runs on them. Andy reviews by hand; \`${role.label}\` passes the check.${footer}`,
    };
  }

  const parsed = mode === "review" ? parseFindings(raw, role) : null;
  if (parsed === null) {
    const why = mode === "review" ? "the agent returned no valid findings" : sanitize(reason);
    return {
      pass: true,
      body: `${head}### ⚠️ ${role.title}: not reviewed\n\nThe agent didn't run: ${why || "unknown reason"}. The check is neutral (passes); Andy decides.${footer}`,
    };
  }

  const blocking = parsed.findings.filter((f) => role.blocking.includes(f.severity));
  const counts = role.severities
    .map((s) => `${s} ${parsed.findings.filter((f) => f.severity === s).length}`)
    .join(" · ");
  let verdict;
  if (blocking.length === 0) verdict = `✅ ${role.title}: no ${role.blockingName} findings`;
  else if (accepted)
    verdict = `⚠️ ${role.title}: ${blocking.length} ${role.blockingName}, accepted by \`${role.label}\``;
  else
    verdict = `❌ ${role.title}: ${blocking.length} ${role.blockingName} — fix or ask Andy for \`${role.label}\``;

  const table = parsed.findings.length > 0 ? `\n\n${findingsTable(parsed.findings, role)}` : "";
  const summary = parsed.summary ? `\n\n${sanitize(parsed.summary)}` : "";
  const resolved =
    parsed.resolved.length > 0
      ? `\n\n**Resolved since the last review:**\n${parsed.resolved.map((r) => `- ${sanitize(r)}`).join("\n")}`
      : "";
  return {
    pass: blocking.length === 0 || accepted,
    body: `${head}### ${verdict}\n\n${counts}${summary}${table}${resolved}${footer}`,
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
    role: process.env.ROLE,
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
