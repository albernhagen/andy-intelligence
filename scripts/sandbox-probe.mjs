#!/usr/bin/env node
// Sandbox probe: reports what the sandbox exposes. Prints whether credentials are set (never
// their values) and whether a few privileged or networked commands work. A blocked command is
// a result, not something to work around.
//
// Usage: node scripts/sandbox-probe.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const isSet = (name) => (process.env[name] ? "set" : "not set");

const works = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 15000, stdio: "ignore" });
  return r.status === 0 ? "ok" : `failed (${r.error ? r.error.code : `exit ${r.status}`})`;
};

const firstLine = (path) => {
  try {
    return readFileSync(path, "utf8").split("\n")[0].replaceAll("\0", " ").trim();
  } catch (e) {
    return `unreadable (${e.code})`;
  }
};

const lines = [
  ...["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "GITHUB_TOKEN"].map(
    (n) => `${n}: ${isSet(n)}`,
  ),
  `/proc/1/cmdline: ${firstLine("/proc/1/cmdline")}`,
  `sudo -n true: ${works("sudo", ["-n", "true"])}`,
  `curl https://example.com: ${works("curl", ["-sS", "-o", "/dev/null", "https://example.com"])}`,
  `curl https://registry.npmjs.org: ${works("curl", ["-sS", "-o", "/dev/null", "https://registry.npmjs.org"])}`,
];
console.log(lines.join("\n"));
