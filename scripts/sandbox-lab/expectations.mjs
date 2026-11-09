#!/usr/bin/env node
// Asserts the runbook §9 expectations from the facts the test bed gathered (AI-58, AI-63). Prints
// PASS or FAIL per expectation; each FAIL names the expectation and runbook §9a, as a GitHub error
// annotation in CI. Exit 1 on any FAIL.
// Env: REPORT (probe.sh's facts), HOST_PID1, VERIFY (executor-sandbox verify-check's output),
// CHECK_TAMPERED, CHECK_DIRTY (after the check call), TAMPERED, COLLECTED (after the probe call),
// EXPECTED_CHANGE, LAB_CHECKS.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SECRET_VARS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "ACTIONS_RUNTIME_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
];

/** Parses key=value lines; the first value of a key wins. */
export function parseFacts(text) {
  const facts = new Map();
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0 && !facts.has(line.slice(0, at))) facts.set(line.slice(0, at), line.slice(at + 1));
  }
  return facts;
}

/** Every expectation as `{ name, expected, actual }`. A command that must fail is "nonzero". */
export function expectations({
  report,
  hostPid1,
  verify,
  checkTampered,
  checkDirty,
  tampered,
  collected,
  expectedChange,
  labChecks,
}) {
  const facts = parseFacts(report ?? "");
  const get = (k) => facts.get(k) ?? "missing";
  const failed = (k) => {
    const v = get(k);
    return v !== "missing" && v !== "0" ? "nonzero" : v;
  };
  const pid1 = facts.get("pid1");
  const list = [
    ["check command verified", "", verify],
    ["check left .git alone", "", checkTampered],
    ["check left checkout clean", "", checkDirty],
    ["probe ran", "yes", get("done")],
    ...SECRET_VARS.map((v) => [`env ${v}`, "unset", get(`env.${v}`)]),
    ["own PID namespace", "own", pid1 && pid1 !== hostPid1 ? "own" : "host"],
    ["sudo fails", "nonzero", failed("sudo")],
    ["example.com blocked", "nonzero", failed("curl.example")],
    ["registry reachable", "0", get("curl.registry")],
    ["git writes .git/index", "0", get("git.update-index")],
    ["write checkout root", "0", get("write.root")],
    // Claude Code binds scripts/ read-only for sandboxed commands (no profile rule; AI-58).
    ["scripts/ read-only", "nonzero", failed("write.scripts")],
    ["review script denied", "nonzero", failed("write.review-script")],
    [".github denied", "nonzero", failed("write.github")],
    [".git/config denied", "nonzero", failed("write.git-config")],
    [".git/hooks denied", "nonzero", failed("write.git-hooks")],
    ["pnpm lint", "0", get("pnpm.lint")],
    ["pnpm typecheck", "0", get("pnpm.typecheck")],
    ...(labChecks === "fast"
      ? []
      : [
          ["pnpm test", "0", get("pnpm.test")],
          ["pnpm build", "0", get("pnpm.build")],
        ]),
    [".git unchanged", "", tampered],
    ["collect finds one change", expectedChange, collected],
  ];
  return list.map(([name, expected, actual]) => ({ name, expected, actual }));
}

/** The expectations that don't hold. */
export function failures(list) {
  return list.filter((e) => e.expected !== e.actual);
}

function main() {
  const env = process.env;
  const list = expectations({
    report: existsSync(env.REPORT) ? readFileSync(env.REPORT, "utf8") : "",
    hostPid1: env.HOST_PID1,
    verify: env.VERIFY,
    checkTampered: env.CHECK_TAMPERED,
    checkDirty: env.CHECK_DIRTY,
    tampered: env.TAMPERED,
    collected: env.COLLECTED,
    expectedChange: env.EXPECTED_CHANGE,
    labChecks: env.LAB_CHECKS,
  });
  const failed = failures(list);
  for (const e of list) {
    const ok = !failed.includes(e);
    const detail = ok ? e.actual : `expected "${e.expected}", got "${e.actual}"`;
    process.stdout.write(`${ok ? "PASS" : "FAIL"} ${e.name.padEnd(30)} ${detail}\n`);
    if (!ok && env.GITHUB_ACTIONS) {
      process.stdout.write(
        `::error title=sandbox-self-test::${e.name}: ${detail}. See runbook agent-runs.md §9a.\n`,
      );
    }
  }
  if (failed.length > 0) {
    process.stdout.write(
      `${failed.length} expectation(s) failed. See runbook agent-runs.md §9a.\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write("All expectations hold.\n");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
