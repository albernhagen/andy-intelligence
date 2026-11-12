// The `Evaluator` adapter (AI-6, ADR-0086; port in packages/contracts): runs each case once, in
// order, through Claude Code, then checks the output against the agent's schema and the case's
// fixed checks. Failure messages are fixed or built from the case, never from model text.
import { checkOutput } from "./assertions.mjs";
import { QUOTA_MAX_PLAUSIBLE_PCT, QUOTA_RESERVE_PCT } from "./config.mjs";
import { schemaProblems } from "./schema-check.mjs";

export class EvalCapError extends Error {
  name = "EvalCapError";
}

const SKIPPED = {
  status: "skipped",
  passed: false,
  inputTokens: null,
  failures: ["skipped: quota reserve"],
};

/** One case's run as an EvalCaseResult. */
export function toCaseResult(spec, run) {
  const inputTokens = Number.isInteger(run.firstInputTokens) ? run.firstInputTokens : null;
  if (run.errorKind) {
    return {
      caseId: spec.id,
      status: "error",
      passed: false,
      inputTokens,
      failures: [`error: ${run.errorKind}`],
    };
  }
  const failures = schemaProblems(run.output, spec.schema).length
    ? ["output does not match the agent's schema"]
    : checkOutput(run.output, spec.expect);
  return { caseId: spec.id, status: "ran", passed: failures.length === 0, inputTokens, failures };
}

export class ClaudeCodeEvaluator {
  /**
   * @param {{ specs: Array<{ id: string, prompt: string, workspace: string, schema: object,
   *   model: string, expect: object[] }>, runCase: (spec: object) => Promise<object>,
   *   source: string }} options
   */
  constructor({ specs, runCase, source }) {
    this.specs = new Map(specs.map((s) => [s.id, s]));
    this.runCase = runCase;
    this.source = source;
  }

  async score() {
    throw new Error("ClaudeCodeEvaluator runs suites: use runSuite");
  }

  async runSuite(suite, { caseIds, maxCases }) {
    if (caseIds.length > maxCases) {
      throw new EvalCapError(`${caseIds.length} cases over the cap of ${maxCases}`);
    }
    const cases = [];
    const readings = [];
    let atReserve = false;
    for (const id of caseIds) {
      const spec = this.specs.get(id);
      if (!spec) throw new Error(`case ${id}: not prepared`);
      if (atReserve) {
        cases.push({ caseId: id, ...SKIPPED });
        continue;
      }
      const run = await this.runCase(spec);
      const quota =
        this.source === "subscription" && Number.isFinite(run.quotaPct) ? run.quotaPct : null;
      if (quota !== null) readings.push(quota);
      if (quota !== null && quota > QUOTA_MAX_PLAUSIBLE_PCT) {
        run.errorKind = "quota reading out of range (utilization is not a 0-1 fraction?)";
      } else if (quota !== null && quota >= QUOTA_RESERVE_PCT) {
        atReserve = true;
      }
      cases.push(toCaseResult(spec, run));
    }
    const quotaPct =
      this.source === "subscription" ? (readings.length ? Math.max(...readings) : null) : undefined;
    return { suite, cases, ...(quotaPct !== undefined && { quotaPct }) };
  }
}
