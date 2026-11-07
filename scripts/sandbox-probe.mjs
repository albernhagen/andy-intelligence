#!/usr/bin/env node
// Sandbox probe: reports what the build sandbox exposes. Prints whether secrets are set, never their values.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const out = (line) => process.stdout.write(`${line}\n`);
const isSet = (name) => Boolean(process.env[name]);
const ok = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 20000 });
  return r.status === 0 ? "ok" : `failed (${r.error?.code ?? `exit ${r.status}`})`;
};

for (const name of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "GITHUB_TOKEN"]) {
  out(`${name}: ${isSet(name) ? "set" : "not set"}`);
}

let cmdline;
try {
  cmdline = readFileSync("/proc/1/cmdline", "utf8").split("\0")[0];
} catch (e) {
  cmdline = `unreadable (${e.code})`;
}
out(`/proc/1/cmdline first line: ${cmdline}`);
out(`sudo -n true: ${ok("sudo", ["-n", "true"])}`);
out(`curl https://example.com: ${ok("curl", ["-sS", "-o", "/dev/null", "https://example.com"])}`);
out(
  `curl https://registry.npmjs.org: ${ok("curl", ["-sS", "-o", "/dev/null", "https://registry.npmjs.org"])}`,
);
