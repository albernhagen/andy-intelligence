#!/usr/bin/env node
// Executor run report (ARCHITECTURE §7.2, §9): turns the claude-code-action step outcome and its
// execution file (the SDK message log; the last `result` message has the answer and usage) into
// the body the control plane takes at POST /runs/{id}/report. A missing or garbled file means a
// failed run with null usage, never a crash.
//
// Env: OUTCOME (the action step's outcome: success | failure | cancelled | skipped), EXECUTION_FILE
// (path), REASON (optional one-line reason, used when the agent left no answer).
// Prints the report JSON on one line to stdout.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MAX_SUMMARY = 20000;

/** Reads the execution file; null when it is missing or not a JSON array. */
export function readMessages(path) {
  if (!path) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/** Shortens text to at most MAX_SUMMARY characters, marking the cut. */
export function truncate(text) {
  if (text.length <= MAX_SUMMARY) return text;
  return `${text.slice(0, MAX_SUMMARY - 1)}…`;
}

const intOrNull = (n) => (Number.isFinite(n) ? Math.trunc(n) : null);

/** Builds { status, summary, tokensIn, tokensOut, costUsd } for the control plane. */
export function buildReport({ outcome, messages, reason }) {
  const result = Array.isArray(messages)
    ? messages.findLast((m) => m && typeof m === "object" && m.type === "result")
    : undefined;
  const usage = result?.usage ?? {};
  const input = intOrNull(usage.input_tokens);
  const cached =
    (intOrNull(usage.cache_read_input_tokens) ?? 0) +
    (intOrNull(usage.cache_creation_input_tokens) ?? 0);
  const succeeded = outcome === "success" && result !== undefined && result.is_error !== true;

  let summary = typeof result?.result === "string" && result.result !== "" ? result.result : null;
  if (!succeeded && summary === null) {
    summary =
      reason ||
      (result?.subtype ? `Agent stopped: ${result.subtype}` : null) ||
      (outcome ? `Agent step ${outcome}; no result in the execution file` : "Agent did not run");
  }

  return {
    status: succeeded ? "succeeded" : "failed",
    summary: summary === null ? null : truncate(String(summary)),
    tokensIn: input === null ? null : input + cached,
    tokensOut: intOrNull(usage.output_tokens),
    costUsd: Number.isFinite(result?.total_cost_usd) ? result.total_cost_usd : null,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = buildReport({
    outcome: process.env.OUTCOME ?? "",
    messages: readMessages(process.env.EXECUTION_FILE),
    reason: process.env.REASON ?? "",
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
