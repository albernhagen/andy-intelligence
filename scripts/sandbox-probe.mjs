#!/usr/bin/env node
// Sandbox probe: reports what a sandboxed command can see and reach. Prints only whether a
// variable is set, never its value. A blocked command is a result, not something to work around.
//
// Usage: node scripts/sandbox-probe.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

for (const name of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "GITHUB_TOKEN"]) {
  console.log(`${name}: ${process.env[name] ? "set" : "not set"}`);
}

try {
  const first = readFileSync("/proc/1/cmdline", "utf8").split("\n")[0].replaceAll("\0", " ");
  console.log(`/proc/1/cmdline (first line): ${first.trim()}`);
} catch (error) {
  console.log(`/proc/1/cmdline: unreadable (${error.code ?? error.message})`);
}

function probe(label, command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 20_000 });
  const ok = result.status === 0;
  const detail = ok
    ? ""
    : ` (${result.error?.code ?? (result.stderr || "").trim().split("\n")[0] ?? `exit ${result.status}`})`;
  console.log(`${label}: ${ok ? "succeeds" : "fails"}${detail}`);
}

probe("sudo -n true", "sudo", ["-n", "true"]);
probe("curl https://example.com", "curl", ["-sS", "-o", "/dev/null", "https://example.com"]);
probe("curl https://registry.npmjs.org", "curl", [
  "-sS",
  "-o",
  "/dev/null",
  "https://registry.npmjs.org",
]);
