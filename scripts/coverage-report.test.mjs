import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  changedLineCoverage,
  changedLines,
  groupOf,
  lineHits,
  ranges,
  render,
  summarize,
} from "./coverage-report.mjs";

const metrics = (covered, total) =>
  Object.fromEntries(
    ["lines", "statements", "functions", "branches"].map((m) => [m, { covered, total }]),
  );

// An istanbul record with one statement per line: `hits` maps line → run count.
const record = (hits) => ({
  statementMap: Object.fromEntries(
    Object.keys(hits).map((line, i) => [i, { start: { line: Number(line) } }]),
  ),
  s: Object.fromEntries(Object.values(hits).map((count, i) => [i, count])),
});

const diff = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,0 +2,3 @@",
  "+x",
  "+y",
  "+z",
  "@@ -9 +12 @@",
  "+w",
  "diff --git a/old.ts b/old.ts",
  "--- a/old.ts",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
].join("\n");

describe("groupOf", () => {
  it.each([
    ["apps/api/src/x.ts", "apps/api"],
    ["packages/domain/src/a/b.ts", "packages/domain"],
    ["scripts/x.mjs", "scripts"],
    ["src/index.ts", "src"],
    ["index.ts", "(root)"],
    ["apps/x.ts", "apps"],
  ])("GivenFile%s_WhenGrouped_ThenItsPackage", (file, group) => {
    expect(groupOf(file)).toBe(group);
  });
});

describe("summarize", () => {
  it("GivenFilesInTwoPackages_WhenSummarized_ThenSumsPerPackageSortedAndSkipsTotal", () => {
    const rows = summarize(
      {
        total: metrics(0, 0),
        "/r/packages/b/src/x.ts": metrics(1, 4),
        "/r/packages/b/src/y.ts": metrics(2, 4),
        "/r/apps/a/src/z.ts": metrics(0, 0),
      },
      "/r",
    );
    expect(rows.map((r) => r.name)).toEqual(["apps/a", "packages/b"]);
    expect(rows[0].lines).toBe(100);
    expect(rows[1].lines).toBe(37.5);
  });
});

describe("changedLines", () => {
  it("GivenADiff_WhenRead_ThenAddedLinesPerFileAndDeletedFilesSkipped", () => {
    const files = changedLines(diff);
    expect([...files.keys()]).toEqual(["src/a.ts"]);
    expect([...files.get("src/a.ts")]).toEqual([2, 3, 4, 12]);
  });

  it("GivenAPureDeletionHunk_WhenRead_ThenNoLines", () => {
    const files = changedLines("+++ b/a.ts\n@@ -3,2 +2,0 @@\n");
    expect([...files.get("a.ts")]).toEqual([]);
  });
});

describe("lineHits", () => {
  it("GivenTwoStatementsOnALine_WhenRead_ThenSumsTheirHits", () => {
    const hits = lineHits({
      statementMap: { 0: { start: { line: 5 } }, 1: { start: { line: 5 } } },
      s: { 0: 0, 1: 2 },
    });
    expect(hits.get(5)).toBe(2);
  });
});

describe("changedLineCoverage", () => {
  it("GivenChangedLinesSomeRun_WhenMeasured_ThenCountsOnlyCodeLines", () => {
    const result = changedLineCoverage(
      { "/r/src/a.ts": record({ 2: 1, 3: 0, 4: 0, 50: 0 }), "/r/src/b.ts": record({ 1: 0 }) },
      diff,
      "/r",
    );
    expect(result).toMatchObject({ covered: 1, total: 3, percent: 33.3 });
    expect(result.files).toEqual([{ file: "src/a.ts", total: 3, missed: [3, 4] }]);
  });

  it("GivenNoMeasuredLinesChanged_WhenMeasured_ThenPercentNull", () => {
    expect(changedLineCoverage({}, diff, "/r").percent).toBeNull();
  });
});

describe("ranges", () => {
  it("GivenSortedLines_WhenCollapsed_ThenRanges", () => {
    expect(ranges([3, 4, 5, 9, 11, 12])).toBe("3-5, 9, 11-12");
  });
});

describe("render", () => {
  const rows = [{ name: "src", lines: 90, statements: 90, functions: 90, branches: 80 }];

  it("GivenNoPr_WhenRendered_ThenTableOnlyAndNoWarning", () => {
    const { markdown, warning } = render(rows, null);
    expect(markdown).toContain("| src | 90.0% | 90.0% | 90.0% | 80.0% |");
    expect(markdown).not.toContain("Changed lines");
    expect(warning).toBeNull();
  });

  it("GivenLowChangedLineCoverage_WhenRendered_ThenListsMissedLinesAndWarns", () => {
    const changed = {
      covered: 1,
      total: 3,
      percent: 33.3,
      files: [{ file: "src/a.ts", total: 3, missed: [3, 4] }],
    };
    const { markdown, warning } = render(rows, changed);
    expect(markdown).toContain("| `src/a.ts` | 3-4 |");
    expect(warning).toContain("33.3%");
  });

  it("GivenHighChangedLineCoverage_WhenRendered_ThenNoWarning", () => {
    const changed = { covered: 9, total: 10, percent: 90, files: [] };
    expect(render(rows, changed).warning).toBeNull();
  });
});

describe("CLI", () => {
  const script = join(import.meta.dirname, "coverage-report.mjs");

  it("GivenACoverageDirAndDiff_WhenRun_ThenAppendsSummaryAndWarns", () => {
    const dir = mkdtempSync(join(tmpdir(), "coverage-report-"));
    writeFileSync(
      join(dir, "coverage-summary.json"),
      JSON.stringify({ [join(dir, "src/a.ts")]: metrics(1, 2) }),
    );
    writeFileSync(
      join(dir, "coverage-final.json"),
      JSON.stringify({ [join(dir, "src/a.ts")]: record({ 2: 0, 3: 0 }) }),
    );
    writeFileSync(join(dir, "pr.diff"), diff);
    const summary = join(dir, "summary.md");
    const out = execFileSync("node", [script, dir, join(dir, "pr.diff")], {
      cwd: dir,
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
      encoding: "utf8",
    });
    expect(readFileSync(summary, "utf8")).toContain("| src | 50.0%");
    expect(out).toContain("::warning::Changed-line coverage is 0.0%");
  });

  it("GivenNoSummaryFile_WhenRun_ThenFails", () => {
    const dir = mkdtempSync(join(tmpdir(), "coverage-report-"));
    expect(() => execFileSync("node", [script, dir], { cwd: dir, stdio: "pipe" })).toThrow();
  });
});
