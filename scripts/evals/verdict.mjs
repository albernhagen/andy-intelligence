// The agent-evals verdict (AI-6): pass rate and token thresholds over one suite run, and the job
// summary. Everything here is numbers, case ids and fixed check messages: no model text.
import { PASS_RATE_MIN, TOKEN_JUMP_MAX } from "./config.mjs";

/**
 * `fail` below PASS_RATE_MIN or on any token jump past TOKEN_JUMP_MAX over the case's baseline;
 * `skipped` when the quota reserve stopped the run and nothing that ran failed; else `pass`.
 * Errors count as failed cases. A case with no baseline is listed, not failed.
 */
export function verdict(run, baselines = {}) {
  const ran = run.cases.filter((c) => c.status !== "skipped");
  const skipped = run.cases.filter((c) => c.status === "skipped");
  const passed = ran.filter((c) => c.passed).length;
  const passRate = ran.length ? passed / ran.length : 1;
  const tokens = ran.map((c) => {
    const baseline = baselines[c.caseId] ?? null;
    const jump = baseline && c.inputTokens !== null ? (c.inputTokens - baseline) / baseline : null;
    return { caseId: c.caseId, inputTokens: c.inputTokens, baseline, jump };
  });
  const jumps = tokens.filter((t) => t.jump !== null && t.jump > TOKEN_JUMP_MAX);
  const missingBaselines = tokens.filter((t) => t.baseline === null && t.inputTokens !== null);
  const reasons = [];
  if (passRate < PASS_RATE_MIN) {
    reasons.push(
      `pass rate ${pct(passRate)} is below ${pct(PASS_RATE_MIN)} (${passed} of ${ran.length})`,
    );
  }
  for (const j of jumps) {
    reasons.push(
      `${j.caseId}: input tokens ${j.inputTokens} are ${pct(j.jump)} over the baseline ${j.baseline} (max +${pct(TOKEN_JUMP_MAX)})`,
    );
  }
  const outcome = reasons.length ? "fail" : skipped.length ? "skipped" : "pass";
  return {
    outcome,
    passRate,
    passed,
    ran: ran.length,
    skipped: skipped.length,
    tokens,
    missingBaselines,
    reasons,
  };
}

const pct = (x) => `${Math.round(x * 1000) / 10}%`;
/** Text safe in a Markdown table cell and on one log line (no workflow commands). */
export const cell = (s) =>
  String(s)
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[\\|`<>]/g, (c) => `\\${c}`)
    .replace(/::/g, ": :");

/** The job summary in Markdown. */
export function summary({ run, result, source, caps, cases }) {
  const icon = { pass: "✅ pass", fail: "❌ fail", skipped: "⏭️ skipped (quota reserve)" }[
    result.outcome
  ];
  const how = source === "stub" ? "stub model: plumbing only, no live model call" : source;
  const lines = [
    `## Agent evals (${how}): ${icon}`,
    "",
    `Source: \`${source}\` · cases ${run.cases.length} (cap ${caps.maxCases}) · turns per case ≤ ${caps.maxTurns} · ${pct(result.passRate)} passed (needs ${pct(PASS_RATE_MIN)}) · token jump max +${pct(TOKEN_JUMP_MAX)}`,
    "",
  ];
  for (const r of result.reasons) lines.push(`- **${cell(r)}**`);
  if (result.skipped) {
    lines.push(`- ${result.skipped} case(s) skipped: the subscription reached the quota reserve.`);
  }
  if (result.reasons.length || result.skipped) lines.push("");
  lines.push("| Case | Agent | Result | Input tokens | Baseline | Failed checks |");
  lines.push("| ---- | ----- | ------ | ------------ | -------- | ------------- |");
  for (const c of run.cases) {
    const t = result.tokens.find((x) => x.caseId === c.caseId);
    const agent = cases.find((x) => x.id === c.caseId)?.agent ?? "";
    const jumped = t?.jump != null && t.jump > TOKEN_JUMP_MAX;
    const status =
      c.status !== "ran" ? c.status : !c.passed ? "fail" : jumped ? "fail (tokens)" : "pass";
    const delta = t?.jump == null ? "" : ` (${t.jump >= 0 ? "+" : ""}${pct(t.jump)})`;
    lines.push(
      `| ${cell(c.caseId)} | ${agent} | ${status} | ${c.inputTokens ?? "–"} | ${t?.baseline ?? "–"}${delta} | ${cell(c.failures.join("; "))} |`,
    );
  }
  if (result.missingBaselines.length && source !== "stub") {
    lines.push(
      "",
      "No committed baseline (add to the suite's `baselines.json` in a PR to check token jumps):",
    );
    for (const m of result.missingBaselines) lines.push(`- \`"${m.caseId}": ${m.inputTokens}\``);
  }
  return `${lines.join("\n")}\n`;
}
