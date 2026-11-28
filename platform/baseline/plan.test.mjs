import { describe, expect, it } from "vitest";
import { fileDrift } from "./files.mjs";
import {
  heldToAdd,
  HELD_BY_APP,
  pathsToRead,
  planBaselinePr,
  RECORD_PATH,
  renderReport,
} from "./plan.mjs";

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

describe("planBaselinePr with a recorded deploy kind", () => {
  const record = (deployKind) =>
    JSON.stringify({ version: SHA, ...(deployKind ? { deployKind } : {}) });
  const planFor = (recorded, deployKind) =>
    planBaselinePr(rendered, new Map([[RECORD_PATH, record(recorded)]]), { ...opts, deployKind });

  it("GivenARecordedNoneAndACloudRunProject_WhenPlanned_ThenTheRecordIsReportedWithTheCommand", () => {
    const p = planFor("none", "cloud-run");
    expect(p.differs).toContainEqual({
      path: RECORD_PATH,
      note: "records deploy kind `none`, but the project's is `cloud-run`: run `files <repo> --ref <ref> --deploy-kind cloud-run --environments prod-only`",
    });
  });

  it("GivenARecordFromBeforeTheFieldAndACloudRunProject_WhenPlanned_ThenItReadsAsNone", () => {
    expect(
      planFor(undefined, "cloud-run")
        .differs.map((d) => d.note)
        .join(),
    ).toContain("records deploy kind `none`");
  });

  it("GivenTheSameKind_WhenPlanned_ThenTheRecordIsNotReported", () => {
    expect(planFor("cloud-run", "cloud-run").differs.map((d) => d.path)).not.toContain(RECORD_PATH);
  });
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
      `npx -y github:albernhagen/andy-intelligence finish albernhagen/web --ref ${SHA} --branch baseline/aaaaaaa`,
    );
    expect(md).toContain("- `lefthook.yml`: differs from the baseline; left unchanged");
    expect(md).toContain("### Applied (");
  });

  it("GivenACloudRunProject_WhenRendered_ThenTheFinishCommandCarriesTheKind", () => {
    const md = renderReport({ ...base, settings: { results: [] }, deployKind: "cloud-run" });
    expect(md).toContain("--branch baseline/aaaaaaa --deploy-kind cloud-run\n");
  });

  it("GivenANoneProject_WhenRendered_ThenTheFinishCommandHasNoKind", () => {
    const md = renderReport({ ...base, settings: { results: [] }, deployKind: "none" });
    expect(md).not.toContain("--deploy-kind");
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
    expect(md).toContain(`  - \`(whole)\`: want \`"present"\`, have \`"'missing'"\``);
    expect(md).toContain("- actions: couldn't read (the App has no administration permission)");
    expect(md).toContain(
      "npx -y github:albernhagen/andy-intelligence apply albernhagen/web --dry-run",
    );
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
    expect(md).toContain(`Couldn't read them: \`"HTTP 500"\`.`);
  });
});

describe("heldToAdd", () => {
  it("GivenABranchWithADifferingWorkflow_WhenChosen_ThenOnlyMissingHeldFilesAreAddedAndNothingIsOverwritten", () => {
    const has = new Set([".github/workflows/ci.yml", "lefthook.yml"]);
    expect(heldToAdd(rendered, (p) => has.has(p)).map((f) => f.path)).toEqual([
      ".claude/settings.json",
    ]);
  });

  it("GivenABranchWithNothing_WhenChosen_ThenNoNonHeldFileIsAdded", () => {
    expect(heldToAdd(rendered, () => false).map((f) => f.path)).toEqual([
      ".github/workflows/ci.yml",
      ".claude/settings.json",
    ]);
  });
});

describe("record written before workflows", () => {
  it("GivenTheMergedPrWithItsRecordButNoWorkflows_WhenDriftIsChecked_ThenMissingAndDifferingFilesStillShow", () => {
    const p = plan({ "package.json": "{}", "lefthook.yml": "mine\n" });
    const repo = new Map([...p.files.map((f) => [f.path, f.content]), ["lefthook.yml", "mine\n"]]);
    const drift = fileDrift(rendered, (path) => repo.get(path) ?? null, {
      source: SOURCE,
      version: SHA,
    });
    expect(drift).toContainEqual({ path: ".github/workflows/ci.yml", issue: "missing" });
    expect(drift).toContainEqual({ path: "lefthook.yml", issue: "differs from the baseline" });
  });

  it("GivenARepoWithTheRecordAtThisSha_WhenPlannedAgain_ThenMissingWorkflowsAreStillHeld", () => {
    const first = plan({ "package.json": "{}" });
    const again = plan(
      Object.fromEntries([["package.json", "{}"], ...first.files.map((f) => [f.path, f.content])]),
    );
    expect(again.files).toEqual([]);
    expect(again.held.map((h) => h.path)).toContain(".github/workflows/ci.yml");
  });
});

describe("report escaping", () => {
  it("GivenRepoControlledMarkdownInASetting_WhenRendered_ThenItIsInsideACodeSpan", () => {
    const p = plan({ "package.json": "{}" });
    const md = renderReport({
      repo: "albernhagen/web",
      source: SOURCE,
      sha: SHA,
      ref: "main",
      branch: "baseline/aaaaaaa",
      plan: p,
      settings: {
        results: [
          {
            section: "labels",
            status: "drift",
            diffs: [
              {
                setting: "[0].description",
                want: "x",
                have: "[click](https://evil) @someone\n# h",
              },
            ],
          },
        ],
      },
    });
    expect(md).toContain('have `"[click](https://evil) @someone\\n# h"`');
  });
});
