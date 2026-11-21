import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = "scripts/cloud-setup.sh";

/** Runs the setup script with fake corepack and pnpm that log their calls; `failOn` makes one fail. */
function runSetup(failOn = "") {
  const bin = mkdtempSync(join(tmpdir(), "cloud-setup-"));
  const log = join(bin, "calls.log");
  for (const tool of ["corepack", "pnpm"]) {
    const path = join(bin, tool);
    writeFileSync(
      path,
      `#!/bin/sh\necho "${tool} $*" >> "${log}"\n[ "${tool} $1" = "${failOn}" ] && exit 3\nexit 0\n`,
    );
    chmodSync(path, 0o755);
  }
  writeFileSync(log, "");
  const r = spawnSync("bash", [SCRIPT], {
    env: { PATH: `${bin}:/usr/bin:/bin` },
    encoding: "utf8",
  });
  return { status: r.status, calls: readFileSync(log, "utf8").trim().split("\n") };
}

describe("cloud-setup.sh", () => {
  it("GivenToolsSucceed_WhenRun_ThenInstallsFrozenThenBuilds", () => {
    expect(runSetup()).toEqual({
      status: 0,
      calls: ["corepack enable", "pnpm install --frozen-lockfile", "pnpm build"],
    });
  });

  it.each(["pnpm install", "pnpm build", "corepack enable"])(
    "GivenStep%sFails_WhenRun_ThenExitsNonZero",
    (step) => {
      expect(runSetup(step).status).toBe(3);
    },
  );

  it("GivenScriptCommands_WhenRead_ThenNoSecretTokenOrEnvVar", () => {
    const commands = readFileSync(SCRIPT, "utf8")
      .split("\n")
      .filter((line) => !line.startsWith("#"));
    expect(commands.join("\n")).not.toMatch(/token|secret|password|_KEY|\$[A-Z]/i);
  });
});
