import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BUDGETS, check, globToRegExp, loadBudgets, measure } from "./context-budget.mjs";
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

describe("CLI", () => {
  const script = join(import.meta.dirname, "context-budget.mjs");
  // `git ls-files` in the CLI must read the temp repo, not a hook's GIT_DIR.
  const run = (dir) =>
    spawnSync(process.execPath, [script, dir], { encoding: "utf8", env: cleanGitEnv() });

  it("GivenSmallAgentsFile_WhenRun_ThenPassesAndSkipsSymlink", () => {
    const result = run(repo({ "AGENTS.md": "rules\n" }));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ok   AGENTS.md: 1/200 lines");
    expect(result.stdout).not.toContain("CLAUDE.md");
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

describe("ADR index", () => {
  it("GivenEveryAdrFile_WhenIndexRead_ThenEachIsListed", () => {
    const dir = join(import.meta.dirname, "..", "docs", "architecture", "adr");
    const index = readFileSync(join(dir, "README.md"), "utf8");
    const missing = readdirSync(dir)
      .filter((f) => /^\d{4}-.*\.md$/.test(f))
      .filter((f) => !index.includes(`](${f})`));
    expect(missing).toEqual([]);
  });
});
