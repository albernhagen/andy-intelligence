import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BUDGETS,
  baseRefFrom,
  check,
  checkHeadroom,
  globToRegExp,
  loadBudgets,
  measure,
  prFailures,
  reportSummary,
} from "./context-budget.mjs";
import { cleanGitEnv } from "./git-env.mjs";

describe("globToRegExp", () => {
  it.each([
    ["**/AGENTS.md", "AGENTS.md", true],
    ["**/AGENTS.md", "infra/AGENTS.md", true],
    ["**/AGENTS.md", "infra/AGENTS.md.template", false],
    ["platform/procedures/*.md", "platform/procedures/security-review.md", true],
    ["platform/procedures/*.md", "platform/procedures/x/y.md", false],
    ["docs/build-log.md", "docs/build-log/2026-11-03-context-budget-built.md", false],
  ])("GivenPattern%sAndPath%s_WhenMatched_Then%s", (pattern, path, expected) => {
    expect(globToRegExp(pattern).test(path)).toBe(expected);
  });
});

describe("measure", () => {
  it("GivenTextWithTrailingNewlines_WhenMeasured_ThenCountsLinesAndWords", () => {
    expect(measure("one two\nthree\n\n")).toEqual({ lines: 2, words: 3 });
    expect(measure("")).toEqual({ lines: 0, words: 0 });
  });
});

describe("check", () => {
  const read = (texts) => (path) => texts[path];

  it("GivenFirstMatchingBudget_WhenChecked_ThenOnlyThatOneApplies", () => {
    const budgets = [
      { pattern: "AGENTS.md", maxLines: 2 },
      { pattern: "**/AGENTS.md", maxLines: 1 },
    ];
    const results = check(
      ["AGENTS.md", "infra/AGENTS.md", "README.md"],
      budgets,
      read({ "AGENTS.md": "a\nb", "infra/AGENTS.md": "a\nb" }),
    );
    expect(results.map((r) => [r.path, r.over])).toEqual([
      ["AGENTS.md", false],
      ["infra/AGENTS.md", true],
    ]);
  });

  it("GivenWordBudget_WhenExceeded_ThenOver", () => {
    const [result] = check(
      ["docs/a.md"],
      [{ pattern: "docs/*.md", maxWords: 2 }],
      read({ "docs/a.md": "one two three" }),
    );
    expect(result).toMatchObject({ words: 3, maxWords: 2, over: true });
  });
});

describe("loadBudgets", () => {
  it("GivenNoConfig_WhenLoaded_ThenDefaults", () => {
    expect(loadBudgets(mkdtempSync(join(tmpdir(), "budget-")))).toBe(DEFAULT_BUDGETS);
  });

  it("GivenEntryWithoutLimit_WhenLoaded_ThenThrows", () => {
    const dir = mkdtempSync(join(tmpdir(), "budget-"));
    writeFileSync(join(dir, "context-budget.json"), '{"budgets":[{"pattern":"a.md"}]}');
    expect(() => loadBudgets(dir)).toThrow("budgets");
  });

  it("GivenThisRepo_WhenLoaded_ThenEveryEntryHasALimit", () => {
    expect(loadBudgets(join(import.meta.dirname, "..")).length).toBeGreaterThan(0);
  });
});

/** A temp git repo holding `files` plus a CLAUDE.md symlink to AGENTS.md, all staged. */
const repo = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "budget-repo-"));
  const env = cleanGitEnv();
  execFileSync("git", ["init", "-q"], { cwd: dir, env });
  for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
  symlinkSync("AGENTS.md", join(dir, "CLAUDE.md"));
  execFileSync("git", ["add", "-A"], { cwd: dir, env });
  return dir;
};

describe("repo helper", () => {
  afterEach(() => vi.unstubAllEnvs());

  // AI-20: git hooks export GIT_DIR / GIT_INDEX_FILE; inherited, they made `git add -A` in the
  // temp dir overwrite the real repository's index on every push.
  it("GivenGitHookEnvironment_WhenTempRepoCreated_ThenOuterRepositoryIndexUnchanged", () => {
    const outer = mkdtempSync(join(tmpdir(), "budget-outer-"));
    const clean = cleanGitEnv();
    execFileSync("git", ["init", "-q"], { cwd: outer, env: clean });
    writeFileSync(join(outer, "keep.txt"), "keep\n");
    execFileSync("git", ["add", "keep.txt"], { cwd: outer, env: clean });
    const index = join(outer, ".git", "index");
    const before = readFileSync(index);

    vi.stubEnv("GIT_DIR", join(outer, ".git"));
    vi.stubEnv("GIT_INDEX_FILE", index);
    repo({ "AGENTS.md": "a\nb\nc\n" });
    vi.unstubAllEnvs();

    expect(readFileSync(index).equals(before)).toBe(true);
  });
});

describe("checkHeadroom", () => {
  const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  const result = (path, text, maxWords) =>
    check([path], [{ pattern: path, maxWords }], () => text)[0];
  const base = (texts) => (path) => texts[path] ?? null;

  it.each([
    ["grows by half the room", 1800, 1900, []],
    ["shrinks while near budget", 1990, 1980, []],
    ["is unchanged at budget", 2000, 2000, []],
    [
      "grows by more than half the room",
      1800,
      1901,
      ["README.md: grew 101 words (1800 → 1901/2000)"],
    ],
    ["grows one word with one left", 1999, 2000, ["README.md: grew 1 words (1999 → 2000/2000)"]],
  ])("GivenAFileThat%s_WhenChecked_ThenProblemsMatch", (_, was, now, expected) => {
    const problems = checkHeadroom(
      [result("README.md", words(now), 2000)],
      base({ "README.md": words(was) }),
    );
    expect(problems.map((p) => p.split(";")[0])).toEqual(expected);
  });

  it("GivenANewFile_WhenChecked_ThenOnlyItsBudgetApplies", () => {
    expect(checkHeadroom([result("docs/new.md", words(250), 250)], base({}))).toEqual([]);
  });

  // AI-143: two PRs from one base that each pass can't push main over together.
  it.each([0, 1000, 1850, 1999, 2000])(
    "GivenTwoPassingPrsFromBase%s_WhenBothMerge_ThenTheFileStaysInBudget",
    (was) => {
      const grow = Math.floor((2000 - was) / 2);
      const pr = result("README.md", words(was + grow), 2000);
      expect(checkHeadroom([pr], base({ "README.md": words(was) }))).toEqual([]);
      expect(was + 2 * grow).toBeLessThanOrEqual(2000);
    },
  );
});

describe("prFailures", () => {
  const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  const result = (path, n, maxWords) =>
    check([path], [{ pattern: path, maxWords }], () => words(n))[0];
  const base = (counts) => (path) => (path in counts ? words(counts[path]) : null);

  // AI-344: each PR fits its half of the room when opened; together three overflow main.
  it("GivenThreePrsThatTogetherOverflowAFile_WhenMainIsOver_ThenOnlyAPrThatGrowsItFails", () => {
    // From 1800/2000 each PR may grow 100; three of them merged leave main at 2100/2000.
    for (let i = 0; i < 3; i++) {
      const pr = result("README.md", 1900, 2000);
      expect(prFailures([pr], base({ "README.md": 1800 })).problems).toEqual([]);
    }
    const onOverMain = prFailures([result("README.md", 2101, 2000)], base({ "README.md": 2100 }));
    expect(onOverMain.problems).toEqual([
      expect.stringContaining("README.md: grew 1 words (2100 → 2101/2000)"),
    ]);
  });

  it("GivenAFileOverOnTheBaseThatThePrDoesntTouch_WhenChecked_ThenReportedNotFailed", () => {
    const out = prFailures(
      [result("README.md", 2100, 2000), result("docs/x.md", 10, 250)],
      base({ "README.md": 2100, "docs/x.md": 5 }),
    );
    expect(out).toEqual({ problems: [], untouched: ["README.md"] });
  });

  it("GivenAPrThatTrimsAnOverBudgetFileButLeavesItOver_WhenChecked_ThenItPasses", () => {
    const out = prFailures([result("README.md", 2050, 2000)], base({ "README.md": 2100 }));
    expect(out).toEqual({ problems: [], untouched: ["README.md"] });
  });

  it("GivenANewFileOverBudget_WhenChecked_ThenItFails", () => {
    const out = prFailures([result("docs/new.md", 300, 250)], base({}));
    expect(out.problems).toEqual(["docs/new.md: a new file over budget (300/250 words)"]);
  });
});

describe("reportSummary", () => {
  it("GivenFilesOverBudget_WhenSummarised_ThenATableOfOnlyThoseFiles", () => {
    const results = [
      { path: "README.md", lines: 9, words: 2100, maxWords: 2000, over: true },
      { path: "AGENTS.md", lines: 9, words: 10, maxLines: 100, over: false },
    ];
    const summary = reportSummary(results);
    expect(summary).toContain("| `README.md` | 2100/2000 words |");
    expect(summary).not.toContain("AGENTS.md");
    expect(reportSummary([results[1]])).toBe("");
  });
});

describe("baseRefFrom", () => {
  it("GivenABaseFlag_WhenRead_ThenUsedWithoutFetching", () => {
    expect(baseRefFrom(["--base", "origin/main"], {})).toEqual({
      ref: "origin/main",
      fetch: false,
    });
  });

  it("GivenAPullRequestOnActions_WhenRead_ThenTheBaseBranchIsFetched", () => {
    expect(baseRefFrom([], { GITHUB_BASE_REF: "main" })).toEqual({ ref: "main", fetch: true });
  });

  it("GivenTheOptOut_WhenRead_ThenNullButAnExplicitBaseStillWins", () => {
    const env = { GITHUB_BASE_REF: "main", CONTEXT_BUDGET_BASE: "none" };
    expect(baseRefFrom([], env)).toBeNull();
    expect(baseRefFrom(["--base", "x"], env)).toEqual({ ref: "x", fetch: false });
  });

  it("GivenNeither_WhenRead_ThenNull", () => {
    expect(baseRefFrom(["."], {})).toBeNull();
  });
});

describe("CLI", () => {
  const script = join(import.meta.dirname, "context-budget.mjs");
  // `git ls-files` in the CLI must read the temp repo, not a hook's GIT_DIR.
  // Without the Actions base branch, so a run behaves the same locally and in CI.
  const noBaseEnv = () => {
    const env = cleanGitEnv();
    delete env.GITHUB_BASE_REF;
    delete env.CONTEXT_BUDGET_BASE;
    return env;
  };
  const run = (dir, extra = {}) =>
    spawnSync(process.execPath, [script, dir], {
      encoding: "utf8",
      env: { ...noBaseEnv(), ...extra },
    });

  it("GivenSmallAgentsFile_WhenRun_ThenPassesAndSkipsSymlink", () => {
    const result = run(repo({ "AGENTS.md": "rules\n" }));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ok   AGENTS.md: 1/200 lines");
    expect(result.stdout).not.toContain("CLAUDE.md");
  });

  it("GivenAFileGrownByMoreThanHalfTheRoom_WhenRunWithBase_ThenExitsOne", () => {
    const budget = '{"budgets":[{"pattern":"AGENTS.md","maxLines":20}]}';
    const dir = repo({ "AGENTS.md": "a\n".repeat(18), "context-budget.json": budget });
    const env = cleanGitEnv();
    const git = (...args) => execFileSync("git", args, { cwd: dir, env });
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "base");
    writeFileSync(join(dir, "AGENTS.md"), "a\n".repeat(20));
    git("add", "AGENTS.md");
    const result = spawnSync(process.execPath, [script, dir, "--base", "HEAD"], {
      encoding: "utf8",
      env,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL AGENTS.md: grew 2 lines (18 → 20/20)");
    expect(run(dir).status).toBe(0);
  });

  it("GivenAPullRequestWhoseBaseCantBeFetched_WhenRun_ThenExitsTwoUnlessOptedOut", () => {
    const dir = repo({ "AGENTS.md": "rules\n" });
    const failed = run(dir, { GITHUB_BASE_REF: "main" });
    expect(failed.status).toBe(2);
    expect(failed.stderr).toContain("CONTEXT_BUDGET_BASE=none");
    expect(run(dir, { GITHUB_BASE_REF: "main", CONTEXT_BUDGET_BASE: "none" }).status).toBe(0);
  });

  // CI found it: GitHub's merge commit is built on an older main; main then trimmed the file.
  it("GivenAMergeCommitBuiltOnAnOlderMain_WhenMainTrimmedTheFileSince_ThenItIsNotThisPrsGrowth", () => {
    const env = noBaseEnv();
    const sh = (cwd, ...args) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
        cwd,
        env,
        encoding: "utf8",
      });
    const origin = mkdtempSync(join(tmpdir(), "budget-origin-"));
    sh(origin, "init", "-q", "--bare", "-b", "main");
    sh(origin, "config", "uploadpack.allowReachableSHA1InWant", "true");
    const dir = mkdtempSync(join(tmpdir(), "budget-merge-"));
    sh(dir, "init", "-q", "-b", "main");
    sh(dir, "remote", "add", "origin", origin);
    const budget = '{"budgets":[{"pattern":"AGENTS.md","maxLines":20}]}';
    writeFileSync(join(dir, "context-budget.json"), budget);
    writeFileSync(join(dir, "AGENTS.md"), "a\n".repeat(18));
    sh(dir, "add", "-A");
    sh(dir, "commit", "-qm", "base");
    const base = sh(dir, "rev-parse", "HEAD").trim();
    sh(dir, "checkout", "-qb", "pr");
    writeFileSync(join(dir, "other.txt"), "pr change\n");
    sh(dir, "add", "-A");
    sh(dir, "commit", "-qm", "pr");
    sh(dir, "checkout", "-q", "main");
    writeFileSync(join(dir, "AGENTS.md"), "a\n".repeat(10));
    sh(dir, "commit", "-qam", "main trims");
    sh(dir, "push", "-q", "origin", "main");
    sh(dir, "checkout", "-q", "--detach", base);
    sh(dir, "merge", "-q", "--no-ff", "--no-edit", "pr");

    const result = run(dir, { GITHUB_BASE_REF: "main" });
    expect(result.stdout).not.toContain("FAIL");
    expect(result.status).toBe(0);
  });

  it("GivenOversizedFileOnMain_WhenRunWithReport_ThenWarnsInTheSummaryAndExitsZero", () => {
    const dir = repo({
      "AGENTS.md": "a\nb\nc\n",
      "context-budget.json": '{"budgets":[{"pattern":"AGENTS.md","maxLines":2}]}',
    });
    const summary = join(mkdtempSync(join(tmpdir(), "budget-summary-")), "summary.md");
    writeFileSync(summary, "");
    const result = spawnSync(process.execPath, [script, dir, "--report"], {
      encoding: "utf8",
      env: { ...noBaseEnv(), GITHUB_STEP_SUMMARY: summary },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning file=AGENTS.md::Over its context budget: 3/2 lines");
    expect(readFileSync(summary, "utf8")).toContain("| `AGENTS.md` | 3/2 lines |");
  });

  it("GivenAFileOverOnTheBase_WhenAPrLeavesItAlone_ThenThePrPassesButALocalRunStillFails", () => {
    const budget = '{"budgets":[{"pattern":"AGENTS.md","maxLines":2}]}';
    const dir = repo({ "AGENTS.md": "a\nb\nc\n", "context-budget.json": budget });
    const env = cleanGitEnv();
    const git = (...args) => execFileSync("git", args, { cwd: dir, env });
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "base");
    writeFileSync(join(dir, "other.txt"), "pr change\n");
    git("add", "other.txt");
    const pr = spawnSync(process.execPath, [script, dir, "--base", "HEAD"], {
      encoding: "utf8",
      env,
    });
    expect(pr.status).toBe(0);
    expect(pr.stdout).toContain("NOTE AGENTS.md: over budget on the base and not grown here");
    expect(run(dir).status).toBe(1);
  });

  it("GivenOversizedFile_WhenRun_ThenExitsOne", () => {
    const dir = repo({
      "AGENTS.md": "a\nb\nc\n",
      "context-budget.json": '{"budgets":[{"pattern":"AGENTS.md","maxLines":2}]}',
    });
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("OVER AGENTS.md: 3/2 lines");
  });
});
