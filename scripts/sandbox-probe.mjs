#!/usr/bin/env node
// Sandbox probe: reports what the build sandbox exposes. Prints only whether a variable is
// set, never its value. A blocked command is a result, not something to work around.
//
// Usage: node scripts/sandbox-probe.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const isSet = (name) => Boolean(process.env[name]);

function ok(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "ignore", timeout: 15_000 });
  return r.status === 0;
}

function firstLineOfCmdline() {
  try {
    const raw = readFileSync("/proc/1/cmdline", "utf8");
    return raw.split("\n")[0].replaceAll("\0", " ").trim();
  } catch (error) {
    return `unreadable (${error.code ?? "error"})`;
  }
}

const lines = [
  ...["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "GITHUB_TOKEN"].map(
    (name) => `${name} set: ${isSet(name)}`,
  ),
  `/proc/1/cmdline first line: ${firstLineOfCmdline()}`,
  `sudo -n true works: ${ok("sudo", ["-n", "true"])}`,
  `curl https://example.com ok: ${ok("curl", ["-sS", "-o", "/dev/null", "https://example.com"])}`,
  `curl https://registry.npmjs.org ok: ${ok("curl", ["-sS", "-o", "/dev/null", "https://registry.npmjs.org"])}`,
];

process.stdout.write(`${lines.join("\n")}\n`);
