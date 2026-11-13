import { describe, expect, it } from "vitest";
import { FileProposal } from "./index";

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
