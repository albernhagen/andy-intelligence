#!/usr/bin/env node
// Executor step procedure (ADR-0032, ADR-0054): builds the agent's prompt from the step's
// procedure (platform/procedures/<step>.md, from the platform's commit) followed by the run's
// prompt, and the `--json-schema` argument from <step>.schema.json when there is one.
//
// Env: STEP (validated by the context job), RUN_PROMPT (the run's prompt; untrusted ticket text),
// PROCEDURES_DIR, GITHUB_OUTPUT, and for sync runs SYNC_CONFLICTS_FILE (a file of NUL-separated
// paths the executor's merge left conflicted; AI-72). Appends `prompt` and, with a schema, `schema_args` outputs.
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const STEP = /^[a-z][a-z-]{0,31}$/;

/** The procedure first (stable prefix for caching, ADR-0046), then the run's prompt. */
export function buildPrompt(procedure, runPrompt) {
  return procedure === null ? runPrompt : `${procedure.trimEnd()}\n\n---\n\n${runPrompt}`;
}

/**
 * `--json-schema '<compact JSON>'` for claude_args, which the action splits like a shell line:
 * the schema must be a JSON object and contain no single quote.
 */
export function schemaArgs(schemaText) {
  let schema;
  try {
    schema = JSON.parse(schemaText);
  } catch {
    throw new Error("schema is not valid JSON");
  }
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error("schema is not a JSON object");
  }
  const compact = JSON.stringify(schema);
  if (compact.includes("'")) throw new Error("schema must not contain a single quote");
  return `--json-schema '${compact}'`;
}

/** Most conflicted paths named in a sync prompt; the agent finds the rest with git grep. */
export const MAX_LISTED_CONFLICTS = 50;

/**
 * A sync run's prompt with the files the executor's merge left conflicted (AI-72). Paths are repo
 * data: one per line, control characters dropped, capped in count and length.
 */
export function withConflicts(runPrompt, conflicts) {
  const paths = (conflicts ?? "")
    .split("\0")
    .map((p) => [...p].filter((c) => c.charCodeAt(0) > 0x1f && c !== "\u007f").join(""))
    .map((p) => p.slice(0, 300))
    .filter((p) => p !== "");
  if (paths.length === 0) return `${runPrompt}\n\nThe merge left no conflicts.`;
  const listed = paths.slice(0, MAX_LISTED_CONFLICTS).map((p) => `- ${p}`);
  if (paths.length > MAX_LISTED_CONFLICTS)
    listed.push(`- … and ${paths.length - MAX_LISTED_CONFLICTS} more`);
  return `${runPrompt}\n\nFiles with conflict markers after the merge:\n${listed.join("\n")}`;
}

/** Reads the step's files; null where a file doesn't exist. */
export function loadStep(dir, step) {
  if (!STEP.test(step)) throw new Error(`invalid step "${step}"`);
  const read = (name) => {
    const path = join(dir, name);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  };
  return { procedure: read(`${step}.md`), schema: read(`${step}.schema.json`) };
}

/** GitHub output lines; the multi-line prompt uses a random delimiter it can't contain. */
export function outputs({ procedure, schema }, runPrompt) {
  const prompt = buildPrompt(procedure, runPrompt);
  let delimiter;
  do delimiter = `PROMPT_${randomBytes(16).toString("hex")}`;
  while (prompt.includes(delimiter));
  const lines = [`prompt<<${delimiter}`, prompt, delimiter];
  if (schema !== null) lines.push(`schema_args=${schemaArgs(schema)}`);
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const step = process.env.STEP ?? "";
  try {
    const files = loadStep(process.env.PROCEDURES_DIR ?? "", step);
    const runPrompt = process.env.RUN_PROMPT ?? "";
    const conflictsFile = process.env.SYNC_CONFLICTS_FILE ?? "";
    appendFileSync(
      process.env.GITHUB_OUTPUT ?? "/dev/stdout",
      outputs(
        files,
        step === "sync"
          ? withConflicts(
              runPrompt,
              conflictsFile && existsSync(conflictsFile) ? readFileSync(conflictsFile, "utf8") : "",
            )
          : runPrompt,
      ),
    );
    process.stdout.write(
      `Step ${step}: procedure ${files.procedure === null ? "no" : "yes"}, schema ${files.schema === null ? "no" : "yes"}.\n`,
    );
  } catch (err) {
    process.stdout.write(
      `::error title=claude-executor::${step}: ${err instanceof Error ? err.message : err}\n`,
    );
    process.exit(1);
  }
}
