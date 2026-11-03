import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { npmOffenders, pnpmOffenders, yarnOffenders } from "./lockfile-sources.mjs";

describe("pnpmOffenders", () => {
  it("GivenIntegrityOnlyResolutions_WhenChecked_ThenNone", () => {
    expect(pnpmOffenders("  zod@4.1.0:\n    resolution: {integrity: sha512-abc==}\n")).toEqual([]);
  });

  it.each([
    "    resolution: {tarball: https://evil.example/zod.tgz}",
    "    resolution: {integrity: sha512-abc==, tarball: https://evil.example/zod.tgz}",
    "    resolution: {type: git, repo: https://github.com/x/y, commit: abc}",
    "    resolution: {directory: ../local, type: directory}",
  ])("GivenNonRegistryResolution%s_WhenChecked_ThenFlagged", (line) => {
    expect(pnpmOffenders(`  pkg@1.0.0:\n${line}\n`)).toEqual([`line 2: ${line.trim()}`]);
  });
});

describe("npmOffenders", () => {
  const lock = (packages) => JSON.stringify({ packages });

  it("GivenRegistryPackagesAndLinks_WhenChecked_ThenNone", () => {
    expect(
      npmOffenders(
        lock({
          "": { name: "root" },
          "node_modules/zod": {
            resolved: "https://registry.npmjs.org/zod/-/zod-4.1.0.tgz",
            integrity: "sha512-x",
          },
          "node_modules/local": { link: true, resolved: "packages/local" },
        }),
      ),
    ).toEqual([]);
  });

  it("GivenOtherHostOrMissingIntegrity_WhenChecked_ThenFlagged", () => {
    const offenders = npmOffenders(
      lock({
        "node_modules/a": { resolved: "https://evil.example/a.tgz", integrity: "sha512-x" },
        "node_modules/b": { resolved: "https://registry.npmjs.org/b/-/b-1.0.0.tgz" },
      }),
    );
    expect(offenders).toHaveLength(2);
  });
});

describe("yarnOffenders", () => {
  it("GivenRegistryAndGitSources_WhenChecked_ThenOnlyGitFlagged", () => {
    const text = [
      '  resolved "https://registry.yarnpkg.com/zod/-/zod-4.1.0.tgz#abc"',
      '  resolved "git+https://github.com/x/y.git#abc"',
    ].join("\n");
    expect(yarnOffenders(text)).toEqual(['line 2: resolved "git+https://github.com/x/y.git#abc"']);
  });
});

describe("CLI", () => {
  const script = join(import.meta.dirname, "lockfile-sources.mjs");
  const run = (files) => {
    const dir = mkdtempSync(join(tmpdir(), "lock-"));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
  };

  it("GivenThisRepoLockfile_WhenRun_ThenPasses", () => {
    const result = spawnSync(process.execPath, [script, join(import.meta.dirname, "..")], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });

  it("GivenTarballInPnpmLock_WhenRun_ThenExitsOne", () => {
    const result = run({
      "pnpm-lock.yaml": "  a@1.0.0:\n    resolution: {tarball: https://evil.example/a.tgz}\n",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL pnpm-lock.yaml");
  });
});
