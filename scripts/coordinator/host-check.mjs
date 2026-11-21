#!/usr/bin/env node
// Host check for a coordinator (AI-149; runbook `coordinating-sessions.md` §6). Read-only.
// Run it first when sessions stall or tests time out: a closed lid or a sleeping Mac freezes every
// session and looks like failing tests (2026-11-16 to 11-20: four days lost). Prints one verdict.
//
// Usage: node scripts/coordinator/host-check.mjs [--json]
import { cpus, loadavg, platform } from "node:os";
import { performance } from "node:perf_hooks";
import { setTimeout as wait } from "node:timers/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { sh } from "./lib.mjs";

/**
 * Lid state from ioreg. `lidClosed` null on a Mac without a lid. `lidSleeps` is false only when
 * macOS says closing the lid won't sleep (clamshell mode: power and an external display).
 */
export function parseLid(ioreg) {
  const state = /"AppleClamshellState" = (Yes|No)/.exec(ioreg)?.[1];
  const sleeps = /"AppleClamshellCausesSleep" = (Yes|No)/.exec(ioreg)?.[1];
  return {
    lidClosed: state === undefined ? null : state === "Yes",
    lidSleeps: sleeps !== "No",
  };
}

/** `Now drawing from 'Battery Power'` → { onBattery, percent }. */
export function parsePower(batt) {
  const percent = /(\d+)%/.exec(batt)?.[1];
  return {
    onBattery: /'Battery Power'/.test(batt),
    percent: percent === undefined ? null : Number(percent),
  };
}

/** Sleep events from `pmset -g log` since `since` (ms), newest last. */
export function parseSleeps(log, since) {
  return log
    .split("\n")
    .map((line) => /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [+-]\d{4}) (Sleep)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map((m) => ({
      at: Date.parse(m[1].replace(" ", "T").replace(/ ([+-]\d\d)(\d\d)$/, "$1:$2")),
      what: m[3].trim(),
    }))
    .filter((e) => Number.isFinite(e.at) && e.at >= since);
}

/** Worst lateness of `rounds` 20 ms timers: a starved or throttled machine runs them late. */
export async function timerLateness(rounds = 10, ms = 20) {
  let worst = 0;
  for (let i = 0; i < rounds; i += 1) {
    const start = performance.now();
    await wait(ms);
    worst = Math.max(worst, performance.now() - start - ms);
  }
  return Math.round(worst);
}

/**
 * One plain verdict from the facts. `ok` false means fix the host before blaming the code.
 * @returns {{ ok: boolean, verdict: string, notes: string[] }}
 */
export function verdict({
  lidClosed,
  lidSleeps,
  onBattery,
  percent,
  sleeps,
  load1,
  cores,
  lateMs,
  now,
}) {
  const problems = [];
  const notes = [];
  if (lidClosed && lidSleeps)
    problems.push("lid is closed and macOS will sleep on it (no external display): open the lid");
  if (onBattery)
    problems.push(
      `on battery (${percent ?? "?"}%): plug in; on battery the Mac sleeps and throttles`,
    );
  const lastHour = sleeps.filter((s) => s.at >= now - 3_600_000);
  if (lastHour.length > 0)
    problems.push(
      `slept ${lastHour.length} time(s) in the last hour: stalled sessions and timeouts since then are the host, not the code`,
    );
  if (load1 > cores * 1.5)
    problems.push(
      `overloaded: load ${load1.toFixed(1)} on ${cores} cores; stagger pushes and test runs`,
    );
  if (lateMs > 100)
    problems.push(`20 ms timers ran up to ${lateMs} ms late: timing-sensitive tests will time out`);
  if (sleeps.length > 0)
    notes.push(
      `${sleeps.length} sleep(s) in the last 24 h, last ${new Date(sleeps.at(-1).at).toISOString()}`,
    );
  notes.push(
    `load ${load1.toFixed(1)} / ${cores} cores, timer lateness ${lateMs} ms, lid ${lidClosed === null ? "n/a" : lidClosed ? "closed" : "open"}, ${onBattery ? "battery" : "power"}`,
  );
  return {
    ok: problems.length === 0,
    verdict:
      problems.length === 0
        ? "OK: host is awake and has room; look at the code"
        : `HOST PROBLEM: ${problems.join("; ")}`,
    notes,
  };
}

async function main() {
  const { values } = parseArgs({
    options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) {
    process.stdout.write(
      "Usage: host-check.mjs [--json]\nRead-only. Lid, power, recent sleeps, load and a 20 ms timer test; prints one verdict.\n",
    );
    return 0;
  }
  const now = Date.now();
  const mac = platform() === "darwin";
  const facts = {
    ...(mac
      ? parseLid(sh("ioreg", ["-r", "-k", "AppleClamshellState", "-d", "4"]).stdout)
      : { lidClosed: null, lidSleeps: false }),
    ...(mac ? parsePower(sh("pmset", ["-g", "batt"]).stdout) : { onBattery: false, percent: null }),
    sleeps: mac ? parseSleeps(sh("pmset", ["-g", "log"]).stdout, now - 86_400_000) : [],
    load1: loadavg()[0],
    cores: cpus().length,
    lateMs: await timerLateness(),
    now,
  };
  const result = verdict(facts);
  if (!mac) result.notes.unshift("not macOS: lid, power and sleep checks skipped");
  if (values.json) process.stdout.write(`${JSON.stringify({ ...result, facts }, null, 2)}\n`);
  else process.stdout.write(`${result.verdict}\n${result.notes.map((n) => `  ${n}`).join("\n")}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
