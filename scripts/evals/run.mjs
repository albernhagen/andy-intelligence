#!/usr/bin/env node
// Agent evals runner (AI-6: M1.17: Agent evals v1, ADR-0086; runbook docs/runbooks/agent-evals.md).
// Reads the cases and the agent configuration under test from one git commit (`--data`, `--ref`),
// runs every case once through Claude Code under promptfoo, and fails below the pass rate or on
// a token jump. Exit 0: pass or skipped (quota reserve); 1: fail or a broken run.
//
//   node scripts/evals/run.mjs [--source subscription|api-key|stub|local] [--data .] [--ref HEAD]
//     [--dir platform/evals/cases] [--cases id,id] [--procedure-override agent=path] [--expect fail]
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { gitTree, loadSuite } from "./cases.mjs";
import {
  AGENTS,
  CASES_DIR,
  MAX_CASES,
  MAX_TURNS_PER_CASE,
  SOURCES,
  TOKEN_JUMP_MAX,
} from "./config.mjs";
import { PromptfooEvaluator } from "./promptfoo-evaluator.mjs";
import { cell, summary, verdict } from "./verdict.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,100}$/;

export function parseArgs(argv) {
  const opts = {
    source: "subscription",
    data: ".",
    ref: "HEAD",
    dir: CASES_DIR,
    cases: [],
    overrides: {},
    expect: "pass",
    claude: "claude",
  };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1] ?? ""];
    if (flag === "--source") opts.source = value;
    else if (flag === "--data") opts.data = value;
    else if (flag === "--ref") opts.ref = value;
    else if (flag === "--dir") opts.dir = value;
    else if (flag === "--claude") opts.claude = value;
    else if (flag === "--expect") opts.expect = value;
    else if (flag === "--cases")
      opts.cases = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else if (flag === "--procedure-override") {
      if (!value) continue;
      const [agent, path] = value.split("=");
      opts.overrides[agent] = path;
    } else throw new Error(`unknown flag ${flag}`);
  }
  if (!SOURCES.includes(opts.source))
    throw new Error(`--source must be one of ${SOURCES.join(", ")}`);
  if (!["pass", "fail"].includes(opts.expect)) throw new Error("--expect must be pass or fail");
  if (!opts.dir.split("/").every((s) => SEGMENT.test(s)))
    throw new Error("--dir must be a plain path");
  for (const [agent, path] of Object.entries(opts.overrides)) {
    if (!Object.hasOwn(AGENTS, agent))
      throw new Error(`--procedure-override: unknown agent ${agent}`);
    if (!path?.endsWith(".md") || !path.split("/").every((s) => SEGMENT.test(s))) {
      throw new Error("--procedure-override path must be a plain .md path in the repo");
    }
  }
  return opts;
}

/** Why the source can't run here, or null. The API-key path stays inert until the secret exists. */
export function credentialProblem(source, env) {
  if (source === "subscription" && !env.CLAUDE_CODE_OAUTH_TOKEN) {
    return "source subscription needs CLAUDE_CODE_OAUTH_TOKEN (the reviewers' repo secret)";
  }
  if (source === "api-key" && !env.ANTHROPIC_API_KEY) {
    return "source api-key needs the AGENT_EVALS_ANTHROPIC_API_KEY repo secret: Andy creates it (runbook agent-evals.md)";
  }
  return null;
}

/** Writes each case's workspace: `.review/` inputs as the review workflows lay them out, plus AGENTS.md. */
export function prepareWorkspaces(tree, cases, overrides, workDir) {
  let agentsMd = null;
  try {
    agentsMd = tree.read("AGENTS.md");
  } catch {
    agentsMd = null;
  }
  return cases.map((c) => {
    const agent = AGENTS[c.agent];
    const ws = join(workDir, "cases", c.id);
    const write = (rel, text) => {
      mkdirSync(dirname(join(ws, rel)), { recursive: true });
      writeFileSync(join(ws, rel), text);
    };
    write(".review/procedure.md", tree.read(overrides[c.agent] ?? agent.procedure));
    const schema = tree.read(agent.schema);
    write(".review/schema.json", schema);
    write(".review/pr.diff", c.diff);
    if (c.discussion !== null) write(".review/discussion.md", c.discussion);
    if (agentsMd !== null) {
      write("AGENTS.md", agentsMd);
      write("CLAUDE.md", agentsMd);
    }
    for (const [to, text] of Object.entries(c.fileContents)) write(to, text);
    mkdirSync(join(workDir, "stub-answers"), { recursive: true });
    writeFileSync(join(workDir, "stub-answers", `${c.id}.json`), JSON.stringify(c.stubOutput));
    return { id: c.id, workspace: ws, schemaFile: join(ws, ".review/schema.json"), schema };
  });
}

/** The promptfoo config: one test per case, our provider, schema validity plus the case's checks. */
export function promptfooConfig({ suite, cases, prepared, source, workDir, stubUrl, claudeBin }) {
  return {
    description: `agent evals: ${suite}`,
    prompts: ["{{task}}"],
    providers: [
      {
        id: `file://${join(HERE, "claude-provider.mjs")}`,
        config: { source, workDir, stubUrl, claudeBin },
      },
    ],
    tests: cases.map((c) => {
      const p = prepared.find((x) => x.id === c.id);
      return {
        description: c.id,
        vars: {
          caseId: c.id,
          task: AGENTS[c.agent].prompt,
          workspace: p.workspace,
          schemaFile: p.schemaFile,
          model: AGENTS[c.agent].model,
        },
        metadata: { expect: c.expect },
        assert: [
          { type: "is-json", value: JSON.parse(p.schema) },
          { type: "javascript", value: `file://${join(HERE, "promptfoo-assert.mjs")}` },
        ],
      };
    }),
  };
}

/** For `--expect fail` (the self-test): every case must have failed, by a check or a token jump. */
export function expectedFailureMet(run, result) {
  const jumped = new Set(
    result.tokens.filter((t) => t.jump !== null && t.jump > TOKEN_JUMP_MAX).map((t) => t.caseId),
  );
  return result.outcome === "fail" && run.cases.every((c) => !c.passed || jumped.has(c.caseId));
}

function startStub(answersDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(HERE, "stub-model.mjs")], {
      env: { PATH: process.env.PATH, STUB_ANSWERS_DIR: answersDir },
      stdio: ["ignore", "pipe", "inherit"],
    });
    child.on("error", reject);
    createInterface({ input: child.stdout }).once("line", (line) => {
      resolve({ url: `http://127.0.0.1:${line.replace("port=", "")}`, stop: () => child.kill() });
    });
  });
}

function report(text) {
  process.stdout.write(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const problem = credentialProblem(opts.source, process.env);
  if (problem) throw new Error(problem);
  const tree = gitTree(opts.data, opts.ref);
  const { cases, baselines } = loadSuite(tree, opts.dir, { only: opts.cases });
  const workDir = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), "agent-evals-"));
  const prepared = prepareWorkspaces(tree, cases, opts.overrides, workDir);
  const stub = opts.source === "stub" ? await startStub(join(workDir, "stub-answers")) : null;
  try {
    const evaluator = new PromptfooEvaluator({
      workDir,
      local: opts.source === "local",
      buildConfig: (suite) =>
        promptfooConfig({
          suite,
          cases,
          prepared,
          source: opts.source,
          workDir,
          stubUrl: stub?.url,
          claudeBin: opts.claude,
        }),
    });
    const run = await evaluator.runSuite(opts.dir, {
      caseIds: cases.map((c) => c.id),
      maxCases: MAX_CASES,
    });
    const result = verdict(run, opts.source === "stub" ? baselines.stub : baselines.live);
    const caps = { maxCases: MAX_CASES, maxTurns: MAX_TURNS_PER_CASE };
    report(summary({ run, result, source: opts.source, caps, cases }));
    if (Object.keys(opts.overrides).length) {
      report(
        `\nProcedure overrides: ${Object.entries(opts.overrides)
          .map(([a, p]) => `${a} → \`${p}\``)
          .join(", ")}\n`,
      );
    }
    if (opts.expect === "fail") {
      const ok = expectedFailureMet(run, result);
      report(
        ok
          ? "\nSelf-test: the check went red as expected.\n"
          : "\n**Self-test: expected every case to fail, and the check to go red.**\n",
      );
      return ok ? 0 : 1;
    }
    return result.outcome === "fail" ? 1 : 0;
  } finally {
    stub?.stop();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      // Escaped line by line: a message can name a path from the PR's tree.
      const text = String(err.message).split("\n").map(cell).join("\n");
      report(`## Agent evals: ❌ could not run\n\n${text}\n`);
      process.exit(1);
    },
  );
}
