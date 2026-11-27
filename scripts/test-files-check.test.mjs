import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countTestFiles } from "./test-files-check.mjs";

const script = join(import.meta.dirname, "test-files-check.mjs");
const run = (input) => execFileSync("node", [script], { input, encoding: "utf8" });

describe("countTestFiles", () => {
  it("GivenAListing_WhenCounted_ThenOnePerNonBlankLine", () => {
    expect(countTestFiles("[api] apps/api/src/a.test.ts\nscripts/b.test.mjs\n\n")).toBe(2);
  });

  it("GivenAnEmptyListing_WhenCounted_ThenZero", () => {
    expect(countTestFiles("")).toBe(0);
    expect(countTestFiles("\n  \n")).toBe(0);
  });
});

describe("CLI", () => {
  it("GivenOneTestFile_WhenRun_ThenPasses", () => {
    expect(run("src/index.test.ts\n")).toContain("Test files in the whole suite: 1");
  });

  it("GivenNoTestFiles_WhenRun_ThenFails", () => {
    expect(() => run("")).toThrow();
  });

  // vitest's own output for a suite with no matching files: nothing on stdout, exit 0. If that
  // changes, the guard must still see zero, so this pins it against the real vitest.
  it("GivenVitestListMatchingNothing_WhenPiped_ThenFails", () => {
    const listing = execFileSync(
      "pnpm",
      ["exec", "vitest", "list", "--filesOnly", "--project", "scripts", "zzz-no-such-test-file"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    expect(countTestFiles(listing)).toBe(0);
    expect(() => run(listing)).toThrow();
  });
});
