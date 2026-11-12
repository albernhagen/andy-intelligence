import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RunReportRequest, RunStep } from "@andy/contracts";

/**
 * The platform's executor scripts, loaded from the platform checkout at the task's commit, never
 * from the project and never bundled into the runner: the profile, procedures, schemas, report
 * parsing and sandbox verdict are exactly what the Actions executor uses at that commit.
 */
export interface Platform {
  /** The platform checkout's root. */
  root: string;
  /** Claude Code settings for `step`, with CODEOWNERS Edit denies anchored at `root`. */
  settings(step: string, projectRoot: string): Record<string, unknown>;
  /** The step's procedure followed by the run's prompt, and the compact `--json-schema` value. */
  prompt(step: RunStep, runPrompt: string): { prompt: string; schema: string | null };
  /** The report body from the agent's messages. */
  report(input: { outcome: string; messages: unknown[] | null; reason: string }): RunReportRequest;
  /** Why the sandbox check's log doesn't show the command run once through Bash; null when it does. */
  checkRunProblem(messages: unknown[] | null, command: string): string | null;
  /** Variables that must not reach a sandboxed command. */
  credentialVars: readonly string[];
}

interface ProfileModule {
  buildProfile(input: {
    profile: unknown;
    step: string;
    codeowners: string;
    root: string;
  }): Record<string, unknown>;
}
interface ProcedureModule {
  loadStep(dir: string, step: string): { procedure: string | null; schema: string | null };
  buildPrompt(procedure: string | null, runPrompt: string): string;
}
interface ReportModule {
  buildReport(input: { outcome: string; messages: unknown; reason: string }): RunReportRequest;
}
interface SandboxModule {
  checkRunProblem(messages: unknown, command: string): string | null;
  CREDENTIAL_VARS: string[];
}

const CODEOWNERS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

async function load<T>(root: string, script: string): Promise<T> {
  return (await import(pathToFileURL(join(root, "scripts", script)).href)) as T;
}

export async function loadPlatform(root: string): Promise<Platform> {
  const [profileModule, procedure, report, sandbox] = await Promise.all([
    load<ProfileModule>(root, "executor-profile.mjs"),
    load<ProcedureModule>(root, "executor-procedure.mjs"),
    load<ReportModule>(root, "executor-report.mjs"),
    load<SandboxModule>(root, "executor-sandbox.mjs"),
  ]);
  const profile: unknown = JSON.parse(
    readFileSync(join(root, "platform", "executor", "profile.json"), "utf8"),
  );
  return {
    root,
    settings(step, projectRoot) {
      const owners = CODEOWNERS.map((f) => join(projectRoot, f)).find((f) => existsSync(f));
      return profileModule.buildProfile({
        profile,
        step,
        codeowners: owners ? readFileSync(owners, "utf8") : "",
        root: projectRoot,
      });
    },
    prompt(step, runPrompt) {
      const files = procedure.loadStep(join(root, "platform", "procedures"), step);
      let schema: string | null = null;
      if (files.schema !== null) {
        const parsed: unknown = JSON.parse(files.schema);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(`${step}.schema.json is not a JSON object`);
        }
        schema = JSON.stringify(parsed);
      }
      return { prompt: procedure.buildPrompt(files.procedure, runPrompt), schema };
    },
    report: (input) => report.buildReport(input),
    checkRunProblem: (messages, command) => sandbox.checkRunProblem(messages, command),
    credentialVars: sandbox.CREDENTIAL_VARS,
  };
}
