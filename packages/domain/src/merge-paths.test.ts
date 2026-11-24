import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KEPT_PATHS } from "./merge-paths";

const OWNER = "@albernhagen";
const CATCH_ALL = new Set(["*", "/*", "**", "/**"]);

/** CODEOWNERS rules as `{ pattern, owners }`, comments and blank lines skipped. */
function parseCodeowners(text: string): { pattern: string; owners: string[] }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const [pattern = "", ...owners] = line.split(/\s+/);
      return { pattern, owners };
    });
}

/**
 * A CODEOWNERS pattern in KEPT_PATHS form. Both are anchored the same way: a leading `/` in
 * CODEOWNERS marks a repo-root path, which KEPT_PATHS writes without it; `**\/` means any depth
 * in both.
 */
const toKeptForm = (pattern: string) => pattern.replace(/^\//, "");

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe.each([
  [".github/CODEOWNERS", "../../../.github/CODEOWNERS"],
  ["template/.github/CODEOWNERS", "../../../template/.github/CODEOWNERS"],
])("%s", (_name, path) => {
  const rules = parseCodeowners(read(path));
  const patterns = rules.map((r) => toKeptForm(r.pattern));

  it("GivenTheFile_WhenEveryKeptPathLooked_ThenEachIsListed", () => {
    expect(KEPT_PATHS.filter((p) => !patterns.includes(p))).toEqual([]);
  });

  it("GivenTheFile_WhenEveryPatternLooked_ThenEachIsAKeptPath", () => {
    expect(patterns.filter((p) => !KEPT_PATHS.includes(p))).toEqual([]);
  });

  it("GivenTheFile_WhenRulesRead_ThenNoCatchAllAndNoDuplicate", () => {
    expect(rules.filter((r) => CATCH_ALL.has(r.pattern))).toEqual([]);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it("GivenTheFile_WhenOwnersRead_ThenAndyOwnsEveryLine", () => {
    expect(rules.filter((r) => r.owners.join(" ") !== OWNER)).toEqual([]);
  });
});

describe("parseCodeowners", () => {
  it("GivenARuleLineOutOfTheList_WhenCompared_ThenItIsReported", () => {
    const patterns = parseCodeowners("# c\n\n/src/new.ts @albernhagen\n").map((r) =>
      toKeptForm(r.pattern),
    );
    expect(patterns.filter((p) => !KEPT_PATHS.includes(p))).toEqual(["src/new.ts"]);
  });
});
