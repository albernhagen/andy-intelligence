import { describe, expect, it } from "vitest";
import {
  baselineRecord,
  fileDrift,
  mergeLines,
  normalizePins,
  pinActions,
  pinModules,
  recordedDeployKind,
  renderFiles,
  seedsToWrite,
} from "./files.mjs";

const SOURCE = "albernhagen/andy-intelligence";
const SHA = "a".repeat(40);
const OLD = "b".repeat(40);

const workflow = [
  "jobs:",
  "  check:",
  "    steps:",
  "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
  "      - uses: ./platform/actions/ci-check",
  "      - name: Prepare",
  "        uses: ./platform/actions/agent-review-prepare",
  "",
].join("\n");

const manifest = {
  source: SOURCE,
  managed: [
    { path: ".github/workflows/ci.yml", from: "wf", pin: true },
    { path: "lefthook.yml", from: "lefthook" },
  ],
  lines: [{ path: ".gitignore", from: "ignore" }],
  seed: [{ path: "AGENTS.md", from: "agents" }],
  starter: [{ path: "package.json", from: "pkg" }],
};
const sources = {
  wf: workflow,
  lefthook: "pre-commit: {}\n",
  ignore: ".env\n*.tfvars\n",
  agents: "# rules\n",
  pkg: "{}\n",
};
const read = (from) => sources[from];

describe("pinActions", () => {
  it("GivenLocalBaselineActions_WhenPinned_ThenRemoteAtShaWithRefComment", () => {
    const out = pinActions(workflow, { source: SOURCE, sha: SHA, ref: "v1.0.0" });
    expect(out).toContain(`      - uses: ${SOURCE}/platform/actions/ci-check@${SHA} # v1.0.0`);
    expect(out).toContain(
      `        uses: ${SOURCE}/platform/actions/agent-review-prepare@${SHA} # v1.0.0`,
    );
    expect(out).not.toContain("./platform/actions");
  });

  it("GivenBlankLinesAndAFinalNewline_WhenPinned_ThenLineStructureKept", () => {
    const text =
      "      - uses: ./platform/actions/a\n\n  next:\n      - uses: ./platform/actions/b\n";
    const out = pinActions(text, { source: SOURCE, sha: SHA, ref: "v1.0.0" });
    expect(out.split("\n")).toHaveLength(text.split("\n").length);
    expect(out.endsWith("# v1.0.0\n")).toBe(true);
  });

  it("GivenThirdPartyActions_WhenPinned_ThenUnchanged", () => {
    const out = pinActions(workflow, { source: SOURCE, sha: SHA, ref: "v1.0.0" });
    expect(out).toContain("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1");
  });
});

describe("normalizePins", () => {
  it("GivenPinnedActions_WhenNormalized_ThenPlaceholderAndShasCollected", () => {
    const pinned = pinActions(workflow, { source: SOURCE, sha: SHA, ref: "v1.0.0" });
    const { text, shas } = normalizePins(pinned, SOURCE);
    expect(text).toContain(`${SOURCE}/platform/actions/ci-check@PINNED`);
    expect([...shas]).toEqual([SHA]);
  });
});

describe("mergeLines", () => {
  it("GivenMissingLines_WhenMerged_ThenAppendedUnderAHeader", () => {
    expect(mergeLines("node_modules/", [".env", "node_modules/"])).toBe(
      "node_modules/\n\n# Project baseline (andy-intelligence)\n.env\n",
    );
  });

  it("GivenAllLinesPresent_WhenMerged_ThenUnchanged", () => {
    expect(mergeLines(".env\n", [".env"])).toBe(".env\n");
  });

  it("GivenNoFile_WhenMerged_ThenOnlyRequiredLines", () => {
    expect(mergeLines("", [".env"])).toBe("# Project baseline (andy-intelligence)\n.env\n");
  });
});

describe("baselineRecord", () => {
  it("GivenAVersion_WhenRecorded_ThenPrettierStyleJson", () => {
    const text = baselineRecord({ source: SOURCE, sha: SHA, ref: "v1.0.0", date: "2026-11-02" });
    expect(JSON.parse(text)).toEqual({
      source: SOURCE,
      version: SHA,
      ref: "v1.0.0",
      updated: "2026-11-02",
      deployKind: "none",
    });
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("GivenACloudRunProject_WhenRecorded_ThenTheKindIsKept", () => {
    const text = baselineRecord({
      source: SOURCE,
      sha: SHA,
      ref: "v1.0.0",
      date: "2026-11-02",
      deployKind: "cloud-run",
    });
    expect(recordedDeployKind(JSON.parse(text))).toBe("cloud-run");
  });

  it("GivenARecordFromBeforeTheField_WhenRead_ThenNone", () => {
    expect(recordedDeployKind({ source: SOURCE, version: SHA })).toBe("none");
  });

  it("GivenAnUnknownRecordedKind_WhenRead_ThenThrows", () => {
    expect(() => recordedDeployKind({ deployKind: "static" })).toThrow("deploy kind");
  });
});

describe("renderFiles with deploy kinds", () => {
  const kinded = {
    ...manifest,
    managed: [
      ...manifest.managed,
      { path: ".github/workflows/deploy.yml", from: "wf", pin: true, deployKind: "cloud-run" },
    ],
  };
  const paths = (deployKind) =>
    renderFiles(kinded, read, { sha: SHA, ref: "v1.0.0", deployKind }).managed.map((f) => f.path);

  it("GivenDeployKindNone_WhenRendered_ThenNoCloudRunFile", () => {
    expect(paths("none")).not.toContain(".github/workflows/deploy.yml");
    expect(paths(undefined)).not.toContain(".github/workflows/deploy.yml");
  });

  it("GivenDeployKindCloudRun_WhenRendered_ThenTheCloudRunFileAndEveryOther", () => {
    expect(paths("cloud-run")).toEqual([
      ".github/workflows/ci.yml",
      "lefthook.yml",
      ".github/workflows/deploy.yml",
    ]);
  });

  it("GivenAnUnknownDeployKind_WhenRendered_ThenThrows", () => {
    expect(() => paths("static")).toThrow("deploy kind must be one of none, cloud-run");
  });
});

describe("fileDrift", () => {
  const rendered = renderFiles(manifest, read, { sha: SHA, ref: "v1.0.0" });
  const repoFiles = () => ({
    ".github/workflows/ci.yml": rendered.managed[0].content,
    "lefthook.yml": "pre-commit: {}\n",
    ".gitignore": "dist/\n.env\n*.tfvars\n",
    "AGENTS.md": "# our own rules\n",
  });
  const reader = (files) => (p) => files[p] ?? null;

  it("GivenAFreshlyOnboardedRepo_WhenChecked_ThenNoDrift", () => {
    expect(fileDrift(rendered, reader(repoFiles()), { source: SOURCE, version: SHA })).toEqual([]);
  });

  it("GivenAnEditedManagedFile_WhenChecked_ThenDiffers", () => {
    const files = { ...repoFiles(), "lefthook.yml": "pre-commit: { skip: true }\n" };
    expect(fileDrift(rendered, reader(files), { source: SOURCE, version: SHA })).toEqual([
      { path: "lefthook.yml", issue: "differs from the baseline" },
    ]);
  });

  it("GivenMissingFiles_WhenChecked_ThenEachReported", () => {
    const drift = fileDrift(rendered, reader({}), { source: SOURCE, version: SHA });
    expect(drift.map((d) => d.path)).toEqual([
      ".github/workflows/ci.yml",
      "lefthook.yml",
      ".gitignore",
      "AGENTS.md",
    ]);
  });

  it("GivenAPinBumpedWithoutUpdatingTheRecord_WhenChecked_ThenStalePinReported", () => {
    const bumped = rendered.managed[0].content.replaceAll(SHA, OLD);
    const files = { ...repoFiles(), ".github/workflows/ci.yml": bumped };
    const drift = fileDrift(rendered, reader(files), { source: SOURCE, version: SHA });
    expect(drift).toHaveLength(1);
    expect(drift[0].issue).toContain("pins bbbbbbb");
  });

  it("GivenAMissingGitignoreLine_WhenChecked_ThenNamed", () => {
    const files = { ...repoFiles(), ".gitignore": ".env\n" };
    expect(fileDrift(rendered, reader(files), { source: SOURCE, version: SHA })).toEqual([
      { path: ".gitignore", issue: "missing lines: *.tfvars" },
    ]);
  });
});

describe("seedsToWrite", () => {
  const seed = [
    { path: "AGENTS.md", content: "# rules\n" },
    { path: "design.md", content: "# Design\n" },
  ];

  it("GivenARepoWithoutTheSeeds_WhenSeeded_ThenEveryOneIsWritten", () => {
    expect(seedsToWrite(seed, () => false).map((f) => f.path)).toEqual(["AGENTS.md", "design.md"]);
  });

  it("GivenAnExistingDesignFile_WhenSeeded_ThenItIsNeverOverwritten", () => {
    const out = seedsToWrite(seed, (p) => p === "design.md");
    expect(out.map((f) => f.path)).toEqual(["AGENTS.md"]);
  });
});

describe("pinModules", () => {
  const tf = [
    'module "prod" {',
    '  source = "../../../../infra/modules/project-env"',
    "}",
    'module "other" {',
    '  source = "terraform-google-modules/network/google"',
    "}",
    "",
  ].join("\n");

  it("GivenALocalModuleSource_WhenPinned_ThenTheRemoteModuleAtTheSha", () => {
    const out = pinModules(tf, { source: SOURCE, sha: SHA, ref: "v1.0.0" });
    expect(out).toContain(
      `  source = "git::https://github.com/${SOURCE}.git//infra/modules/project-env?ref=${SHA}" # v1.0.0\n`,
    );
    expect(out).not.toContain("../");
  });

  it("GivenARegistryModuleSource_WhenPinned_ThenUnchanged", () => {
    const out = pinModules(tf, { source: SOURCE, sha: SHA, ref: "v1.0.0" });
    expect(out).toContain('  source = "terraform-google-modules/network/google"\n');
  });
});

describe("renderFiles with environments", () => {
  const seeded = {
    ...manifest,
    seed: [
      { path: "AGENTS.md", from: "agents" },
      {
        path: "infra/main.tf",
        from: "one",
        pin: true,
        deployKind: "cloud-run",
        environments: "prod-only",
      },
      { path: "infra/main.tf", from: "two", deployKind: "cloud-run", environments: "dev-and-prod" },
    ],
  };
  const texts = { ...Object.fromEntries([["agents", "rules"]]), one: "one", two: "two" };
  const seedFor = (deployKind, environments) =>
    renderFiles(seeded, (from) => texts[from] ?? read(from), {
      sha: SHA,
      ref: "v1.0.0",
      deployKind,
      environments,
    }).seed.map((f) => `${f.path}=${f.content}`);

  it("GivenDeployKindNone_WhenRendered_ThenNoEnvironmentSeed", () => {
    expect(seedFor("none", "dev-and-prod")).toEqual(["AGENTS.md=rules"]);
  });

  it("GivenCloudRunProdOnly_WhenRendered_ThenTheProdOnlySeed", () => {
    expect(seedFor("cloud-run", undefined)).toEqual(["AGENTS.md=rules", "infra/main.tf=one"]);
  });

  it("GivenCloudRunDevAndProd_WhenRendered_ThenTheDevAndProdSeed", () => {
    expect(seedFor("cloud-run", "dev-and-prod")).toEqual(["AGENTS.md=rules", "infra/main.tf=two"]);
  });

  it("GivenAnUnknownPolicy_WhenRendered_ThenThrows", () => {
    expect(() => seedFor("cloud-run", "staging")).toThrow("environments must be one of");
  });
});
