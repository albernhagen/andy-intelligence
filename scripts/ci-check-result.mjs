#!/usr/bin/env node
// The required `check` (AI-402): lint, typecheck, test and build run as parallel jobs, and this
// final gate passes only when every one of them succeeded. It runs with `if: always()`, so it
// reports even when a part fails, is skipped or is cancelled, and each of those fails it.
//
// CLI: reads the caller's `toJSON(needs)` from $RESULTS, prints each job's result, exits 1 unless
// all are `success`.
import { fileURLToPath } from "node:url";

/**
 * Judges a workflow's `needs` context. Ok only when it names at least one job and every job's
 * result is exactly "success"; anything unreadable fails.
 */
export function judgeResults(text) {
  let needs;
  try {
    needs = JSON.parse(text);
  } catch {
    return { ok: false, lines: ["results are not JSON: the gate can't tell what ran"] };
  }
  if (needs === null || typeof needs !== "object" || Array.isArray(needs)) {
    return { ok: false, lines: ["results are not a needs object"] };
  }
  const jobs = Object.entries(needs);
  if (jobs.length === 0) return { ok: false, lines: ["no parts to judge: needs is empty"] };
  const lines = jobs.map(([job, value]) => `${job}: ${value?.result ?? "unknown"}`);
  return { ok: jobs.every(([, value]) => value?.result === "success"), lines };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { ok, lines } = judgeResults(process.env.RESULTS ?? "");
  for (const line of lines) process.stdout.write(`${line}\n`);
  if (!ok) {
    process.stdout.write("::error::check: a part did not succeed (failed, skipped or cancelled)\n");
    process.exit(1);
  }
  process.stdout.write("check: every part passed\n");
}
