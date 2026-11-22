import { describe, expect, it } from "vitest";
import { HELD_BY_APP, pathsToRead, planBaselinePr, RECORD_PATH, renderReport } from "./plan.mjs";

const SOURCE = "albernhagen/andy-intelligence";
const SHA = "a".repeat(40);
const opts = { source: SOURCE, sha: SHA, ref: "main", date: "2026-11-22" };

const rendered = {
  managed: [
    {
      path: ".github/workflows/ci.yml",
      content: `uses: ${SOURCE}/platform/actions/ci@${SHA} # main\n`,
    },
    { path: ".claude/settings.json", content: "{}\n" },
    { path: "lefthook.yml", content: "pre-commit: {}\n" },
    { path: ".prettierrc.json", content: "{}\n" },
  ],
  lines: [{ path: ".gitignore", lines: ["*.tfvars", ".env*"] }],
  seed: [{ path: "AGENTS.md", content: "# Rules\n" }],
  starter: [{ path: "src/index.ts", content: "export {};\n" }],
};

const plan = (files) => planBaselinePr(rendered, new Map(Object.entries(files)), opts);

describe("planBaselinePr", () => {
  it("GivenARepoWithNoBaselineFiles_WhenPlanned_ThenItWritesAllButHeldFilesAndRecordsTheVersion", () => {
    const p = plan({ "package.json": "{}" });
    expect(p.files.map((f) => f.path)).toEqual([
      "lefthook.yml",
      ".prettierrc.json",
      ".gitignore",
      "AGENTS.md",
      RECORD_PATH,
    ]);
    expect(JSON.parse(p.files.at(-1).content)).toMatchObject({ source: SOURCE, version: SHA });
    expect(p.held).toEqual([
      { path: ".github/workflows/ci.yml", note: "missing" },
      { path: ".claude/settings.json", note: "missing" },
    ]);
    expect(p.differs).toEqual([]);
  });

  it("GivenFilesThatDiffer_WhenPlanned_ThenTheyAreReportedAndNeverWritten", () => {
    const p = plan({
      "package.json": "{}",
      "lefthook.yml": "mine: true\n",
      ".github/workflows/ci.yml": "mine: true\n",
    });
    expect(p.files.map((f) => f.path)).not.toContain("lefthook.yml");
    expect(p.files.map((f) => f.path)).not.toContain(".github/workflows/ci.yml");
    expect(p.differs).toContainEqual({
      path: "lefthook.yml",
      note: "differs from the baseline; left unchanged",
    });
    expect(p.held).toContainEqual({
      path: ".github/workflows/ci.yml",
      note: "differs from the baseline; left unchanged",
    });
  });

  it("GivenAWorkflowPinnedToAnotherSha_WhenPlanned_ThenItCountsAsTheSame", () => {
    const other = `uses: ${SOURCE}/platform/actions/ci@${"b".repeat(40)} # v1\n`;
    const p = plan({ "package.json": "{}", ".github/workflows/ci.yml": other });
    expect(p.held.map((h) => h.path)).not.toContain(".github/workflows/ci.yml");
  });

  it("GivenAnExistingSeedAndGitignore_WhenPlanned_ThenTheSeedIsSkippedAndOnlyMissingLinesAppended", () => {
    const p = plan({ "package.json": "{}", "AGENTS.md": "# Ours\n", ".gitignore": "*.tfvars\n" });
    expect(p.skipped).toContainEqual({
      path: "AGENTS.md",
      note: "already there (seed: the project's own)",
    });
    const gitignore = p.files.find((f) => f.path === ".gitignore");
    expect(gitignore.content).toBe("*.tfvars\n\n# Project baseline (andy-intelligence)\n.env*\n");
  });

  it("GivenNoPackageJson_WhenPlanned_ThenStarterFilesAreSkippedForTheCli", () => {
    const p = plan({});
    expect(p.files.map((f) => f.path)).not.toContain("src/index.ts");
    expect(p.skipped.map((s) => s.path)).toContain("src/index.ts");
  });

  it("GivenARecordOfAnotherBaseline_WhenPlanned_ThenItIsLeftAndReported", () => {
    const p = plan({
      "package.json": "{}",
      [RECORD_PATH]: JSON.stringify({ version: "c".repeat(40) }),
    });
    expect(p.files.map((f) => f.path)).not.toContain(RECORD_PATH);
    expect(p.differs.map((d) => d.path)).toContain(RECORD_PATH);
  });

  it("GivenEveryPlannedPath_WhenListed_ThenPathsToReadCoversThem", () => {
    const paths = pathsToRead(rendered);
    for (const f of plan({}).files) expect(paths).toContain(f.path);
    expect(paths).toContain("package.json");
  });
});

describe("HELD_BY_APP", () => {
  it.each([".github/workflows/ci.yml", ".GitHub/Workflows/x.yml", ".claude/settings.json"])(
    "GivenTheHeldPath%s_WhenTested_ThenHeld",
    (p) => expect(HELD_BY_APP.test(p)).toBe(true),
  );
  it.each([".github/dependabot.yml", ".github/CODEOWNERS", "lefthook.yml"])(
    "GivenTheWritablePath%s_WhenTested_ThenNotHeld",
    (p) => expect(HELD_BY_APP.test(p)).toBe(false),
  );
});

describe("renderReport", () => {
  const p = plan({ "package.json": "{}", "lefthook.yml": "mine\n" });
  const base = {
    repo: "albernhagen/web",
    source: SOURCE,
    sha: SHA,
    ref: "main",
    branch: "baseline/aaaaaaa",
    plan: p,
  };

  it("GivenHeldFiles_WhenRendered_ThenItGivesTheOneFinishCommand", () => {
    const md = renderReport({ ...base, settings: { results: [] } });
    expect(md).toContain(
      `node platform/baseline/baseline.mjs finish albernhagen/web --ref ${SHA} --branch baseline/aaaaaaa`,
    );
    expect(md).toContain("- `lefthook.yml`: differs from the baseline; left unchanged");
    expect(md).toContain("### Applied (");
  });

  it("GivenSettingsResults_WhenRendered_ThenEachSectionAndItsDifferencesAreListedWithApply", () => {
    const md = renderReport({
      ...base,
      settings: {
        results: [
          { section: "labels", status: "ok", diffs: [] },
          {
            section: "ruleset",
            status: "drift",
            diffs: [{ setting: "", want: "present", have: "`missing`" }],
          },
          { section: "actions", status: "unreadable", diffs: [] },
        ],
      },
    });
    expect(md).toContain("- labels: matches");
    expect(md).toContain("- ruleset: differs; left unchanged");
    expect(md).toContain(`  - \`(whole)\`: want "present", have "'missing'"`);
    expect(md).toContain("- actions: couldn't read (the App has no administration permission)");
    expect(md).toContain("node platform/baseline/baseline.mjs apply albernhagen/web --dry-run");
  });

  it("GivenManySettingDifferences_WhenRendered_ThenTheyAreCapped", () => {
    const diffs = Array.from({ length: 40 }, (_, i) => ({ setting: `s${i}`, want: 1, have: 2 }));
    const md = renderReport({
      ...base,
      settings: { results: [{ section: "repo", status: "drift", diffs }] },
    });
    expect(md).toContain("and 10 more differences");
  });

  it("GivenASettingsReadError_WhenRendered_ThenTheErrorAndApplyCommandAreShown", () => {
    const md = renderReport({ ...base, settings: { error: "HTTP 500" } });
    expect(md).toContain(`Couldn't read them: "HTTP 500".`);
  });
});
