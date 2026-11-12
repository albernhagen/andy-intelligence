import { execFile } from "node:child_process";
import { RunReportRequest, type RunStep } from "@andy/contracts";
import type { Confinement } from "./seatbelt";

/**
 * The platform's executor scripts (profile, procedures, schemas, report parsing), from the
 * platform checkout at the task's commit, never from the project and never bundled into the
 * runner: they are exactly what the Actions executor uses at that commit.
 *
 * They run in a child process, not the runner's: a clean environment (PATH only), under the
 * runner's Seatbelt profile with no network, no Keychain and no reads outside the platform
 * checkout, the task's checkout and the agent's stream. So a bad platform commit can't reach
 * the runner secret or the per-run token in the runner's memory (ADR-0098).
 */
export interface Platform {
  root: string;
  /** Claude Code settings for `step`, with CODEOWNERS Edit denies anchored at the checkout. */
  settings(step: string, projectRoot: string): Promise<Record<string, unknown>>;
  /** The step's procedure followed by the run's prompt, and the compact `--json-schema` value. */
  prompt(step: RunStep, runPrompt: string): Promise<{ prompt: string; schema: string | null }>;
  /** The report body from the agent's stream file (one SDK message per line). */
  report(input: { outcome: string; streamPath: string; reason: string }): Promise<RunReportRequest>;
}

/** Runs in the child: imports the platform scripts by path, answers one request on stdout. */
const HARNESS = `
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.argv.at(-1);
const load = (name) => import(pathToFileURL(join(root, "scripts", name)).href);
const req = JSON.parse(readFileSync(0, "utf8"));
let out;
if (req.op === "settings") {
  const { buildProfile } = await load("executor-profile.mjs");
  const profile = JSON.parse(readFileSync(join(root, "platform", "executor", "profile.json"), "utf8"));
  const owners = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]
    .map((f) => join(req.projectRoot, f)).find((f) => existsSync(f));
  out = buildProfile({ profile, step: req.step, codeowners: owners ? readFileSync(owners, "utf8") : "", root: req.projectRoot });
} else if (req.op === "prompt") {
  const { loadStep, buildPrompt } = await load("executor-procedure.mjs");
  const files = loadStep(join(root, "platform", "procedures"), req.step);
  let schema = null;
  if (files.schema !== null) {
    const parsed = JSON.parse(files.schema);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(req.step + ".schema.json is not a JSON object");
    schema = JSON.stringify(parsed);
  }
  out = { prompt: buildPrompt(files.procedure, req.runPrompt), schema };
} else if (req.op === "report") {
  const { buildReport } = await load("executor-report.mjs");
  const messages = [];
  const text = existsSync(req.streamPath) ? readFileSync(req.streamPath, "utf8") : "";
  for (const line of text.split("\\n")) {
    try { const m = JSON.parse(line); if (m && typeof m === "object") messages.push(m); } catch {}
  }
  out = buildReport({ outcome: req.outcome, messages: messages.length > 0 ? messages : null, reason: req.reason });
} else {
  throw new Error("unknown op");
}
process.stdout.write(JSON.stringify(out));
`;

/**
 * The settings keys a platform profile may set (those of `platform/executor/profile.json`).
 * Anything else, and above all `hooks`, `apiKeyHelper`, `statusLine` or `env` (commands or
 * variables Claude Code would run or set), is refused, so a bad platform commit can't run a
 * command in the agent's process. Hooks must be off.
 */
export const AGENT_SETTINGS_KEYS = new Set([
  "allowManagedPermissionRulesOnly",
  "allowManagedHooksOnly",
  "disableAllHooks",
  "allowManagedMcpServersOnly",
  "allowedMcpServers",
  "enableAllProjectMcpServers",
  "strictKnownMarketplaces",
  "permissions",
  "sandbox",
]);

export function checkAgentSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const extra = Object.keys(settings).filter((k) => !AGENT_SETTINGS_KEYS.has(k));
  if (extra.length > 0)
    throw new Error(`platform settings have keys the runner refuses: ${extra.join(", ")}`);
  if (settings.disableAllHooks !== true) throw new Error("platform settings don't turn hooks off");
  const servers = settings.allowedMcpServers;
  if (servers !== undefined && !(Array.isArray(servers) && servers.length === 0))
    throw new Error("platform settings allow MCP servers");
  return settings;
}

export interface PlatformOptions {
  root: string;
  confinement: Confinement;
  /** The Seatbelt profile the child runs under. */
  profilePath: string;
}

export function loadPlatform(options: PlatformOptions): Platform {
  const call = (request: Record<string, unknown>): Promise<unknown> => {
    const wrapped = options.confinement.wrap(options.profilePath, process.execPath, [
      "--input-type=module",
      "-e",
      HARNESS,
      "--",
      options.root,
    ]);
    return new Promise((resolve, reject) => {
      const child = execFile(
        wrapped.command,
        wrapped.args,
        {
          cwd: options.root,
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
          maxBuffer: 16 * 1024 * 1024,
          timeout: 60_000,
        },
        (err, stdout, stderr) => {
          if (err) {
            reject(
              new Error(`platform ${String(request.op)} failed: ${stderr.trim().slice(-300)}`, {
                cause: err,
              }),
            );
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch (parseErr) {
            reject(
              new Error(`platform ${String(request.op)} answered no JSON`, { cause: parseErr }),
            );
          }
        },
      );
      child.stdin?.end(JSON.stringify(request));
    });
  };
  const object = (value: unknown, what: string): Record<string, unknown> => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new Error(`platform ${what} is not an object`);
    return value as Record<string, unknown>;
  };
  return {
    root: options.root,
    settings: async (step, projectRoot) =>
      checkAgentSettings(object(await call({ op: "settings", step, projectRoot }), "settings")),
    async prompt(step, runPrompt) {
      const out = object(await call({ op: "prompt", step, runPrompt }), "prompt");
      if (typeof out.prompt !== "string") throw new Error("platform prompt has no text");
      if (out.schema !== null && typeof out.schema !== "string")
        throw new Error("platform schema is not a string");
      return { prompt: out.prompt, schema: out.schema };
    },
    async report(input) {
      return RunReportRequest.parse(await call({ op: "report", ...input }));
    },
  };
}
