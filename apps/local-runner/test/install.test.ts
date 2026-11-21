import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installDependencies } from "../src/install";
import { noConfinement } from "../src/seatbelt";

/** A `pnpm` stand-in that records its arguments and exits with `code`. */
function stubPnpm(root: string, code: number) {
  const script = join(root, "pnpm");
  writeFileSync(
    script,
    `#!/bin/sh\nprintf '%s\\n' "$@" > '${join(root, "pnpm-args")}'\necho 'ERR_PNPM_OUTDATED_LOCKFILE' >&2\nexit ${code}\n`,
  );
  chmodSync(script, 0o755);
  return script;
}

function setup(lockfile: boolean, code = 0) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lr-install-")));
  const checkout = join(root, "checkout");
  mkdirSync(checkout);
  if (lockfile) writeFileSync(join(checkout, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  return {
    root,
    run: () =>
      installDependencies({
        checkout,
        runDir: join(root, "run"),
        runnerHome: join(root, "home"),
        confinement: noConfinement,
        timeoutMs: 10_000,
        signal: new AbortController().signal,
        pnpm: stubPnpm(root, code),
      }),
  };
}

describe("dependency install before a build (AI-133)", () => {
  it("GivenALockfile_WhenInstalled_ThenPnpmRunsFrozenWithScriptsAndPnpmfileOff", async () => {
    const s = setup(true);
    expect(await s.run()).toEqual({ kind: "installed" });
    const args = readFileSync(join(s.root, "pnpm-args"), "utf8").trim().split("\n");
    expect(args.slice(0, 4)).toEqual([
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--ignore-pnpmfile",
    ]);
    expect(args).toContain("--store-dir");
  });

  it("GivenNoLockfile_WhenInstalled_ThenNothingRuns", async () => {
    const s = setup(false);
    expect(await s.run()).toEqual({ kind: "skipped" });
    expect(() => readFileSync(join(s.root, "pnpm-args"))).toThrow();
  });

  it("GivenAFailingInstall_WhenInstalled_ThenFailedWithItsLastLines", async () => {
    const s = setup(true, 1);
    const result = await s.run();
    expect(result.kind).toBe("failed");
    expect(result.kind === "failed" && result.reason).toContain("ERR_PNPM_OUTDATED_LOCKFILE");
  });
});
