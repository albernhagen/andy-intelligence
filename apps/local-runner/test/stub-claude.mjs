#!/usr/bin/env node
// A stand-in for `claude -p` in tests: no model call. Its behaviour comes from config.json next
// to it; every call is appended to calls.jsonl there. It loads settings sources the way Claude
// Code does: all three unless `--setting-sources` names fewer, and runs the hooks found in the
// project's (.claude/settings.json) and local (.claude/settings.local.json) settings.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { setInterval, setTimeout } from "node:timers";

const here = dirname(process.argv[1]);
const config = JSON.parse(readFileSync(join(here, "config.json"), "utf8"));
const args = process.argv.slice(2);
const stdin = readFileSync(0, "utf8");
appendFileSync(
  join(here, "calls.jsonl"),
  `${JSON.stringify({ args, cwd: process.cwd(), envNames: Object.keys(process.env), stdin })}\n`,
);

const emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

const at = args.indexOf("--setting-sources");
const sources =
  config.ignoreSettingSources || at === -1
    ? ["user", "project", "local"]
    : args[at + 1].split(",").filter((s) => s !== "");
const files = { project: ".claude/settings.json", local: ".claude/settings.local.json" };
for (const source of sources) {
  const file = files[source] && join(process.cwd(), files[source]);
  if (!file || !existsSync(file)) continue;
  const hooks = JSON.parse(readFileSync(file, "utf8")).hooks ?? {};
  for (const entries of Object.values(hooks)) {
    for (const entry of entries) for (const h of entry.hooks) execFileSync("sh", ["-c", h.command]);
  }
}

emit({ type: "system", subtype: "init", tools: ["Read"] });

if (stdin.startsWith("This is a sandbox check.")) {
  // The Bash check (ADR-0102): "pass" writes the facts a sandboxed Bash would; "open" as if the
  // network were open; "offline" as if nothing answered; "refuse" as if Bash were refused.
  const mode = config.sandboxCheck ?? "pass";
  const command = stdin.trim().split("\n").at(-1);
  emit({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Bash", input: { command } }] },
  });
  if (mode !== "refuse") {
    writeFileSync(
      join(process.cwd(), ".executor-sandbox-check"),
      `nonce=${process.env.SANDBOX_CHECK_NONCE}\ncanary=denied\n` +
        (mode === "open"
          ? "registry=200\nother_exit=0\nother_connect=000\n"
          : mode === "offline"
            ? "registry=000\nother_exit=6\nother_connect=000\n"
            : "registry=200\nother_exit=56\nother_connect=403\n"),
    );
  }
  emit({ type: "result", subtype: "success", is_error: false, result: "0" });
  process.exit(0);
}

if (stdin.includes("read README.md")) {
  const first = readFileSync(join(process.cwd(), "README.md"), "utf8").split("\n")[0];
  emit({ type: "result", subtype: "success", is_error: false, result: first });
  process.exit(0);
}

if (config.agent === "hang") {
  setInterval(() => undefined, 1000);
} else if (config.agent === "fail") {
  emit({ type: "result", subtype: "error_max_turns", is_error: true });
  process.exit(1);
} else {
  // Lets the runner's heartbeats run while the "agent" works.
  await new Promise((resolve) => setTimeout(resolve, config.agentDelayMs ?? 0));
  for (const [path, text] of Object.entries(config.edit ?? {})) {
    mkdirSync(dirname(join(process.cwd(), path)), { recursive: true });
    writeFileSync(join(process.cwd(), path), text);
  }
  emit({
    type: "assistant",
    message: { content: [{ type: "text", text: "Reading the ticket." }] },
  });
  emit({
    type: "rate_limit_event",
    rate_limit_info: { rateLimitType: "five_hour", utilization: 0.2, resetsAt: 1794500000 },
  });
  emit({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Refined.",
    structured_output: config.output ?? null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5 },
    total_cost_usd: 0.01,
    num_turns: 2,
    duration_ms: 1000,
  });
}
