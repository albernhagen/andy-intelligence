// The `Evaluator` adapter (AI-6, ADR-0086; port in packages/contracts): writes a promptfoo config,
// runs the pinned promptfoo CLI once over the cases, and maps its results to EvalCaseResult.
import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROMPTFOO_VERSION } from "./config.mjs";

/** promptfoo's exit codes: 0 all passed, 100 some failed. Anything else is a broken run. */
const OK_EXIT_CODES = [0, 100];

export class EvalCapError extends Error {
  name = "EvalCapError";
}

/** Runs a command with inherited stdio and resolves its exit code. */
export function execInherit(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", env });
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
}

function failuresOf(component) {
  if (component.pass) return [];
  const type = component.assertion?.type;
  if (type === "is-json") return ["output does not match the agent's schema"];
  if (type === "javascript") return String(component.reason ?? "check failed").split("\n");
  return [`${type ?? "assertion"} failed`];
}

/** One promptfoo result as an EvalCaseResult. Only our provider's fixed strings are copied. */
export function toCaseResult(caseId, r) {
  if (!r)
    return { caseId, status: "error", passed: false, inputTokens: null, failures: ["no result"] };
  const md = r.response?.metadata ?? r.metadata ?? {};
  const inputTokens = Number.isInteger(md.firstInputTokens) ? md.firstInputTokens : null;
  if (md.skipped === "quota") {
    return {
      caseId,
      status: "skipped",
      passed: false,
      inputTokens: null,
      failures: ["skipped: quota reserve"],
    };
  }
  const components = r.gradingResult?.componentResults ?? [];
  if (md.errorKind || ((r.error || r.response?.error) && components.length === 0)) {
    const kind = typeof md.errorKind === "string" ? md.errorKind : "provider error";
    return { caseId, status: "error", passed: false, inputTokens, failures: [`error: ${kind}`] };
  }
  const failures = components.flatMap(failuresOf);
  if (!r.success && failures.length === 0) failures.push("check failed");
  return { caseId, status: "ran", passed: failures.length === 0, inputTokens, failures };
}

export class PromptfooEvaluator {
  /**
   * @param {{ workDir: string, buildConfig: (suite: string, caseIds: string[]) => object,
   *   exec?: (cmd: string, args: string[], env: object) => Promise<number>, env?: object }} options
   */
  constructor({ workDir, buildConfig, exec = execInherit, env = process.env }) {
    this.workDir = workDir;
    this.buildConfig = buildConfig;
    this.exec = exec;
    this.env = env;
  }

  async score() {
    throw new Error("PromptfooEvaluator scores cases: use runSuite");
  }

  async runSuite(suite, { caseIds, maxCases }) {
    if (caseIds.length > maxCases) {
      throw new EvalCapError(`${caseIds.length} cases over the cap of ${maxCases}`);
    }
    if (caseIds.length === 0) return { suite, cases: [] };
    const config = join(this.workDir, "promptfooconfig.json");
    const out = join(this.workDir, "promptfoo-results.json");
    writeFileSync(config, JSON.stringify(this.buildConfig(suite, caseIds), null, 2));
    rmSync(out, { force: true });
    const env = {
      ...this.env,
      PROMPTFOO_DISABLE_TELEMETRY: "1",
      PROMPTFOO_DISABLE_UPDATE: "1",
      PROMPTFOO_CONFIG_DIR: join(this.workDir, "promptfoo-home"),
      npm_config_ignore_scripts: "true",
    };
    const args = ["-y", `promptfoo@${PROMPTFOO_VERSION}`, "eval", "-c", config, "-o", out];
    args.push("--no-cache", "-j", "1", "--no-write", "--no-table", "--no-progress-bar");
    const code = await this.exec("npx", args, env);
    if (!OK_EXIT_CODES.includes(code)) throw new Error(`promptfoo exited with code ${code}`);
    const results = JSON.parse(readFileSync(out, "utf8")).results?.results ?? [];
    const byId = new Map(results.map((r) => [r.vars?.caseId ?? r.testCase?.vars?.caseId, r]));
    return { suite, cases: caseIds.map((id) => toCaseResult(id, byId.get(id))) };
  }
}
