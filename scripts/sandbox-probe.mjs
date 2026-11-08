#!/usr/bin/env node
// Sandbox probe: reports what the sandbox exposes. Prints only whether a variable is set,
// never its value.
//
// Usage: node scripts/sandbox-probe.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const say = (line) => process.stdout.write(`${line}\n`);

for (const name of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "GITHUB_TOKEN"]) {
  say(`${name}: ${process.env[name] ? "set" : "not set"}`);
}

try {
  const cmdline = readFileSync("/proc/1/cmdline", "utf8");
  say(`/proc/1/cmdline first line: ${cmdline.split(/[\n\0]/)[0]}`);
} catch (error) {
  say(`/proc/1/cmdline: unreadable (${error.code ?? error.message})`);
}

function works(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore", timeout: 20_000 });
  return result.status === 0;
}

say(`sudo -n true: ${works("sudo", ["-n", "true"]) ? "works" : "fails"}`);
for (const url of ["https://example.com", "https://registry.npmjs.org"]) {
  say(`curl -sS ${url}: ${works("curl", ["-sS", "-o", "/dev/null", url]) ? "succeeds" : "fails"}`);
}
