#!/usr/bin/env node
// Executor run report (ARCHITECTURE §7.2, §9): turns the claude-code-action step outcome and its
// execution file (the SDK message log; the last `result` message has the answer and usage) into
// the body the control plane takes at POST /runs/{id}/report. A missing or garbled file means a
// failed run with null usage, never a crash. Steps run with --json-schema (refine, ADR-0054) also
// send the agent's `structured_output` as `output`; the control plane checks it.
//
// Env: OUTCOME (the action step's outcome: success | failure | cancelled | skipped), EXECUTION_FILE
// (path), REASON (optional one-line reason, used when the agent left no answer).
// Prints the report JSON on one line to stdout.
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MAX_SUMMARY = 20000;
/**
 * With a structured output, the summary is only a fallback, and the output is dropped when it is
 * this big (UTF-8 bytes); together they stay under the control plane's 96 KB report cap.
 */
export const MAX_SUMMARY_WITH_OUTPUT = 4000;
export const MAX_OUTPUT_BYTES = 48 * 1024;

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

/** Shortens text to at most `max` characters, marking the cut. */
export function truncate(text, max = MAX_SUMMARY) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** The result's structured output, or null when absent or too big to send. */
export function structuredOutput(result) {
  const output = result?.structured_output;
  if (output === undefined || output === null) return null;
  const size = Buffer.byteLength(JSON.stringify(output), "utf8");
  return size <= MAX_OUTPUT_BYTES ? output : null;
}

/**
 * The fields the quota gauge needs from the last `rate_limit_event` (subscription runs; Claude Code
 * emits one when a window moves), or null when the run had none. The control plane validates them.
 */
export function rateLimits(messages) {
  if (!Array.isArray(messages)) return null;
  const info = messages.findLast((m) => m?.type === "rate_limit_event")?.rate_limit_info;
  if (!info || typeof info !== "object") return null;
  const { unifiedWindows, rateLimitType, utilization, resetsAt } = info;
  return { unifiedWindows, rateLimitType, utilization, resetsAt };
}

const intOrNull = (n) => (Number.isFinite(n) ? Math.trunc(n) : null);

/** Builds { status, summary, tokensIn, tokensOut, costUsd, output?, rateLimits? } for the control plane. */
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

  const output = succeeded ? structuredOutput(result) : null;
  const report = {
    status: succeeded ? "succeeded" : "failed",
    summary:
      summary === null
        ? null
        : truncate(String(summary), output === null ? MAX_SUMMARY : MAX_SUMMARY_WITH_OUTPUT),
    tokensIn: input === null ? null : input + cached,
    tokensOut: intOrNull(usage.output_tokens),
    costUsd: Number.isFinite(result?.total_cost_usd) ? result.total_cost_usd : null,
  };
  const limits = rateLimits(messages);
  return {
    ...report,
    ...(output === null ? {} : { output }),
    ...(limits === null ? {} : { rateLimits: limits }),
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
