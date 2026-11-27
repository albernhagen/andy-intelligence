import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkPlaywrightImage, imageVersions, lockedVersions } from "./playwright-image.mjs";

const lock = (...versions) =>
  `packages:\n\n${versions.map((v) => `  '@playwright/test@${v}':\n    resolution: {}\n`).join("")}`;
const workflow = (version) => ({
  path: ".github/workflows/ui-screenshots.yml",
  text: `    container:\n      image: mcr.microsoft.com/playwright:v${version}-noble@sha256:${"a".repeat(64)}\n`,
});

describe("lockedVersions", () => {
  it("GivenPnpmLockWithPackageAndSnapshot_WhenRead_ThenOneVersion", () => {
    expect(
      lockedVersions(`${lock("1.65.1")}\nsnapshots:\n\n  '@playwright/test@1.65.1':\n`),
    ).toEqual(["1.65.1"]);
  });

  it("GivenOtherPlaywrightPackages_WhenRead_ThenIgnored", () => {
    expect(
      lockedVersions("  playwright-core@1.60.0:\n  '@vitest/browser-playwright': 5.0.5\n"),
    ).toEqual([]);
  });
});

describe("imageVersions", () => {
  it("GivenWorkflowWithPinnedImage_WhenRead_ThenVersionAndPath", () => {
    expect(imageVersions([workflow("1.65.1")])).toEqual([
      { path: ".github/workflows/ui-screenshots.yml", version: "1.65.1" },
    ]);
  });
});

describe("checkPlaywrightImage", () => {
  it("GivenMatchingVersions_WhenChecked_ThenOk", () => {
    expect(
      checkPlaywrightImage({ lockText: lock("1.65.1"), workflows: [workflow("1.65.1")] }).ok,
    ).toBe(true);
  });

  it("GivenPackageBumpedWithoutImage_WhenChecked_ThenFailsAndNamesTheFix", () => {
    const result = checkPlaywrightImage({
      lockText: lock("1.66.0"),
      workflows: [workflow("1.65.1")],
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain(".github/workflows/ui-screenshots.yml (v1.65.1)");
    expect(result.message).toContain("mcr.microsoft.com/playwright:v1.66.0-noble@sha256:");
    expect(result.message).toContain("docker buildx imagetools inspect");
  });

  it("GivenNoPlaywrightImage_WhenChecked_ThenOk", () => {
    expect(
      checkPlaywrightImage({ lockText: "", workflows: [{ path: "x.yml", text: "on: push" }] }).ok,
    ).toBe(true);
  });

  it("GivenImageButNoLockedPackage_WhenChecked_ThenFails", () => {
    const result = checkPlaywrightImage({ lockText: "", workflows: [workflow("1.65.1")] });
    expect(result).toEqual({ ok: false, message: expect.stringContaining("found none") });
  });

  it("GivenTwoLockedVersions_WhenChecked_ThenFails", () => {
    const result = checkPlaywrightImage({
      lockText: lock("1.65.1", "1.66.0"),
      workflows: [workflow("1.65.1")],
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("1.65.1, 1.66.0");
  });

  // This repo: the screenshot job's image matches the locked package (what CI's check enforces).
  it("GivenThisRepo_WhenChecked_ThenImageMatchesPackage", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const dir = join(root, ".github", "workflows");
    const workflows = readdirSync(dir)
      .filter((n) => n.endsWith(".yml"))
      .map((n) => ({ path: n, text: readFileSync(join(dir, n), "utf8") }));
    const lockText = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
    expect(checkPlaywrightImage({ lockText, workflows })).toMatchObject({ ok: true });
  });
});
