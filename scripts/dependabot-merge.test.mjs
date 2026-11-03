import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decide } from "./dependabot-merge.mjs";

const PATCH = "version-update:semver-patch";
const MINOR = "version-update:semver-minor";
const MAJOR = "version-update:semver-major";

const dep = (updateType, prevVersion, dependencyName = "vitest") => ({
  dependencyName,
  updateType,
  prevVersion,
});
const npm = (...deps) => ({ ecosystem: "npm_and_yarn", dependencies: JSON.stringify(deps) });

describe("decide", () => {
  it("GivenNpmPatchAndStableMinor_WhenDecided_ThenMerges", () => {
    expect(decide(npm(dep(PATCH, "0.4.2"), dep(MINOR, "5.0.5", "zod"))).merge).toBe(true);
  });

  it("GivenNpmZeroMajorMinor_WhenDecided_ThenLeftForAndy", () => {
    const result = decide(npm(dep(PATCH, "5.0.5"), dep(MINOR, "0.4.2", "hono")));
    expect(result).toEqual({
      merge: false,
      reason: expect.stringContaining("hono is a 0.x minor"),
    });
  });

  it("GivenNpmMajorInGroup_WhenDecided_ThenLeftForAndy", () => {
    expect(decide(npm(dep(PATCH, "1.0.0"), dep(MAJOR, "5.9.3", "typescript"))).merge).toBe(false);
  });

  it("GivenMinorWithoutPreviousVersion_WhenDecided_ThenLeftForAndy", () => {
    expect(decide(npm(dep(MINOR, undefined))).merge).toBe(false);
  });

  it.each(["github_actions", "terraform", "", undefined])(
    "GivenEcosystem%s_WhenDecided_ThenLeftForAndy",
    (ecosystem) => {
      const deps = JSON.stringify([dep(PATCH, "3.99.3", "trufflehog")]);
      expect(decide({ ecosystem, dependencies: deps }).merge).toBe(false);
    },
  );

  it.each(["", "not json", "{}", "[]", undefined])(
    "GivenUnreadableDependencies%s_WhenDecided_ThenLeftForAndy",
    (dependencies) => {
      expect(decide({ ecosystem: "npm_and_yarn", dependencies }).merge).toBe(false);
    },
  );
});

describe("CLI", () => {
  const script = join(import.meta.dirname, "dependabot-merge.mjs");
  const run = (env) => {
    const output = join(mkdtempSync(join(tmpdir(), "dependabot-merge-")), "output");
    const stdout = execFileSync(process.execPath, [script], {
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...env },
      encoding: "utf8",
    });
    return { stdout, output: readFileSync(output, "utf8") };
  };

  it("GivenNpmPatchEnv_WhenRun_ThenWritesMergeTrue", () => {
    const { stdout, output } = run({
      ECOSYSTEM: "npm_and_yarn",
      DEPENDENCIES: JSON.stringify([dep(PATCH, "5.0.5")]),
    });
    expect(output).toBe("merge=true\n");
    expect(stdout).toContain("auto-merge");
  });

  it("GivenActionsEnv_WhenRun_ThenWritesMergeFalse", () => {
    const { stdout, output } = run({
      ECOSYSTEM: "github_actions",
      DEPENDENCIES: JSON.stringify([dep(PATCH, "3.99.3")]),
    });
    expect(output).toBe("merge=false\n");
    expect(stdout).toContain("merged by hand");
  });
});
