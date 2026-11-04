#!/usr/bin/env node
// Executor permission self-test check (ADR-0040, ARCHITECTURE §7.2). Before every agent run, a
// short Claude Code session with a trusted prompt tries to Read a decoy `.env.selftest` holding a
// random token, which the managed permission profile denies. This script reads that session's
// execution file and passes only if the read was denied and the token appears nowhere in the
// session: proof the profile is enforced. Anything else fails closed and the real agent never
// starts.
//
// Env: OUTCOME (the self-test step's outcome), EXECUTION_FILE (path), FORBIDDEN (the decoy's
// token, which must not leak). Prints {"ok": boolean, "reason": string} on one line.
import { fileURLToPath } from "node:url";
import { readMessages } from "./executor-report.mjs";

/** How many tool calls the session's permission rules refused. */
export function countDenials(result) {
  if (!result || typeof result !== "object") return 0;
  if (Array.isArray(result.permission_denials)) return result.permission_denials.length;
  return Number.isInteger(result.permission_denials_count) ? result.permission_denials_count : 0;
}

/** { ok, reason } for the self-test session's messages. */
export function checkSelfTest({ outcome, messages, forbidden }) {
  if (!Array.isArray(messages)) {
    return { ok: false, reason: `permission self-test did not run (step ${outcome || "unknown"})` };
  }
  const secret = (forbidden ?? "").trim();
  if (secret && JSON.stringify(messages).includes(secret)) {
    return { ok: false, reason: "permission profile not enforced: the decoy file was read" };
  }
  const result = messages.findLast((m) => m && typeof m === "object" && m.type === "result");
  const denials = countDenials(result);
  if (denials < 1) {
    return {
      ok: false,
      reason: "permission profile not proven: the self-test read was not denied",
    };
  }
  return { ok: true, reason: `permission profile enforced (${denials} denied tool call)` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = checkSelfTest({
    outcome: process.env.OUTCOME ?? "",
    messages: readMessages(process.env.EXECUTION_FILE),
    forbidden: process.env.FORBIDDEN ?? "",
  });
  process.stdout.write(`${JSON.stringify(check)}\n`);
}
