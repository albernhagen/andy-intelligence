import { describe, expect, it } from "vitest";
import { assertSettingSubpath, BaselineProposal, FileProposal, MAX_BASELINE_FILES } from "./index";

/** AI-107: what a proposed file may be; the App's credential writes it. */

const ok = {
  branch: "brief/ai-20261112080000-abcd1234",
  path: "docs/product/brief.md",
  content: "x",
  message: "m",
  title: "t",
  body: "",
};

describe("FileProposal path", () => {
  it.each(["docs/product/brief.md", "specs/weekly-summary.md", ".prettierrc.json", "a/.b/c.md"])(
    "GivenThePlainPath%s_WhenParsed_ThenAccepted",
    (path) => {
      expect(FileProposal.safeParse({ ...ok, path }).success).toBe(true);
    },
  );

  it.each([
    ".github/workflows/x.yml",
    ".GITHUB/x",
    ".claude/settings.json",
    ".github",
    "./.github/x",
    "a/../.github/x",
    "docs/./brief.md",
    "..",
    "/etc/passwd",
    "docs//brief.md",
    "docs\\brief.md",
    "%2Egithub/x",
    ".github%2Fx",
    "docs/%2e%2e/.github/x",
    "",
  ])("GivenTheUnsafePath%s_WhenParsed_ThenRefused", (path) => {
    expect(FileProposal.safeParse({ ...ok, path }).success).toBe(false);
  });
});

describe("BaselineProposal", () => {
  const base = { branch: "baseline/abc1234", message: "m", title: "t", body: "" };
  const withPath = (path: string) => ({ ...base, files: [{ path, content: "x" }] });

  it.each([".github/dependabot.yml", ".github/CODEOWNERS", "lefthook.yml", ".andy/baseline.json"])(
    "GivenTheBaselinePath%s_WhenParsed_ThenAccepted",
    (path) => {
      expect(BaselineProposal.safeParse(withPath(path)).success).toBe(true);
    },
  );

  it.each([
    ".github/workflows/ci.yml",
    ".GitHub/Workflows/x.yml",
    ".claude/settings.json",
    "a/../.github/workflows/x.yml",
    "/etc/passwd",
  ])("GivenTheHeldPath%s_WhenParsed_ThenRefused", (path) => {
    expect(BaselineProposal.safeParse(withPath(path)).success).toBe(false);
  });

  it("GivenTooManyFilesOrAnotherBranch_WhenParsed_ThenRefused", () => {
    const files = Array.from({ length: MAX_BASELINE_FILES + 1 }, (_, i) => ({
      path: `f${i}.md`,
      content: "x",
    }));
    expect(BaselineProposal.safeParse({ ...base, files }).success).toBe(false);
    expect(BaselineProposal.safeParse({ ...withPath("a.md"), branch: "brief/x" }).success).toBe(
      false,
    );
  });
});

describe("assertSettingSubpath", () => {
  it.each(["", "rulesets?includes_parents=false", "labels/security-accepted", "labels/a%20b"])(
    "GivenTheSafeSubpath%s_WhenChecked_ThenAccepted",
    (subpath) => {
      expect(() => assertSettingSubpath(subpath)).not.toThrow();
    },
  );

  it.each(["../x", "/user", "a//b", "a?b#c", "%2e%2e/x", "a%2fb", "https://x"])(
    "GivenTheUnsafeSubpath%s_WhenChecked_ThenRefused",
    (subpath) => {
      expect(() => assertSettingSubpath(subpath)).toThrow(/unsafe/);
    },
  );
});
