import { describe, expect, it } from "vitest";
import {
  changedPaths,
  dependencyBumpOutput,
  fileAt,
  gateOutput,
  isDependencyBump,
  isDocsOnly,
} from "./review-scope.mjs";

describe("isDocsOnly", () => {
  it("GivenOnlyDocsAndReadmes_WhenChecked_ThenTrue", () => {
    expect(isDocsOnly(["docs/build-log.md", "README.md", "apps/api/README.md", ""])).toBe(true);
  });

  it("GivenAnyCodeOrWorkflowFile_WhenChecked_ThenFalse", () => {
    expect(isDocsOnly(["docs/build-log.md", "scripts/review-gate.mjs"])).toBe(false);
    expect(isDocsOnly(["README.md", ".github/workflows/ci.yml"])).toBe(false);
    expect(isDocsOnly(["infra/bootstrap/main.tf"])).toBe(false);
  });

  it("GivenAgentRuleFiles_WhenChecked_ThenFalse", () => {
    expect(isDocsOnly(["AGENTS.md"])).toBe(false);
    expect(isDocsOnly(["CLAUDE.md"])).toBe(false);
    expect(isDocsOnly(["docs/BUILD-PROMPT.md"])).toBe(false);
  });

  it("GivenProcedureMarkdown_WhenChecked_ThenFalse", () => {
    expect(isDocsOnly(["platform/procedures/security-review.md"])).toBe(false);
  });

  it("GivenNoFiles_WhenChecked_ThenFalse", () => {
    expect(isDocsOnly([])).toBe(false);
    expect(isDocsOnly([" ", ""])).toBe(false);
  });
});

// The UI screenshots gate (AI-358): `run=false` only for a readable, docs-only change.
describe("gateOutput", () => {
  it("GivenDocsOnlyChange_WhenGated_ThenSkips", () => {
    expect(gateOutput(() => ["docs/runbooks/x.md", "docs/build-log.md", "README.md"])).toBe(
      "run=false",
    );
  });

  it("GivenDocsAndCodeChange_WhenGated_ThenRuns", () => {
    expect(gateOutput(() => ["docs/build-log.md", "apps/web/src/App.tsx"])).toBe("run=true");
  });

  it("GivenProcedureMarkdown_WhenGated_ThenRuns", () => {
    expect(gateOutput(() => ["docs/build-log.md", "platform/procedures/build.md"])).toBe(
      "run=true",
    );
  });

  it("GivenNestedAgentsMd_WhenGated_ThenRuns", () => {
    expect(gateOutput(() => ["docs/build-log.md", "infra/AGENTS.md"])).toBe("run=true");
    expect(gateOutput(() => [".github/AGENTS.md"])).toBe("run=true");
  });

  it("GivenDetectionThrows_WhenGated_ThenRuns", () => {
    expect(
      gateOutput(() => {
        throw new Error("git failed");
      }),
    ).toBe("run=true");
  });

  it("GivenEmptyChange_WhenGated_ThenRuns", () => {
    expect(gateOutput(() => [""])).toBe("run=true");
  });
});

describe("changedPaths", () => {
  it("GivenNoBaseRef_WhenRead_ThenThrows", () => {
    expect(() => changedPaths("")).toThrow();
  });

  it("GivenUnknownBaseRef_WhenGatedThroughGit_ThenRuns", () => {
    expect(gateOutput(() => changedPaths("no-such-ref-ai-358"))).toBe("run=true");
  });
});

// Dependabot bumps (AI-394): manifests and lockfiles only, every version within its major.
describe("isDependencyBump", () => {
  const pkg = (deps, extra = {}) =>
    JSON.stringify({ name: "x", ...extra, dependencies: deps }, null, 2);
  // read(side, path) over a map of { path: [baseText, headText] }; a missing side is null.
  const reader = (files) => (side, path) => files[path]?.[side === "base" ? 0 : 1] ?? null;

  it("GivenMinorAndPatchBumpsWithLockfile_WhenChecked_ThenTrue", () => {
    const read = reader({
      "apps/web/package.json": [
        pkg({ a: "^1.2.3", b: "2.0.0", c: "~0.4.1" }),
        pkg({ a: "^1.9.0", b: "2.0.5", c: "~0.4.7" }),
      ],
    });
    expect(isDependencyBump(["apps/web/package.json", "pnpm-lock.yaml", ""], read)).toBe(true);
  });

  it("GivenLockfileOnly_WhenChecked_ThenTrue", () => {
    expect(isDependencyBump(["pnpm-lock.yaml"], reader({}))).toBe(true);
  });

  it("GivenMajorBump_WhenChecked_ThenFalse", () => {
    const read = reader({
      "package.json": [pkg({ "web-push": "^3.6.7" }), pkg({ "web-push": "^4.0.0" })],
    });
    expect(isDependencyBump(["package.json", "pnpm-lock.yaml"], read)).toBe(false);
  });

  it("GivenZeroMajorMinorBump_WhenChecked_ThenFalse", () => {
    const read = reader({ "package.json": [pkg({ a: "^0.4.1" }), pkg({ a: "^0.5.0" })] });
    expect(isDependencyBump(["package.json"], read)).toBe(false);
  });

  it("GivenNonSemverRange_WhenChanged_ThenFalse", () => {
    const read = reader({ "package.json": [pkg({ a: "^1.0.0" }), pkg({ a: "github:evil/a" })] });
    expect(isDependencyBump(["package.json"], read)).toBe(false);
    const pre = reader({ "package.json": [pkg({ a: "1.0.0" }), pkg({ a: "1.1.0-beta.1" })] });
    expect(isDependencyBump(["package.json"], pre)).toBe(false);
  });

  it("GivenScriptsOrOverridesChanged_WhenChecked_ThenFalse", () => {
    const scripts = reader({
      "package.json": [
        pkg({ a: "1.0.0" }, { scripts: { test: "vitest" } }),
        pkg({ a: "1.0.1" }, { scripts: { test: "curl x | sh" } }),
      ],
    });
    expect(isDependencyBump(["package.json"], scripts)).toBe(false);
    const overrides = reader({
      "package.json": [
        pkg({ a: "1.0.0" }),
        pkg({ a: "1.0.0" }, { pnpm: { overrides: { b: "1.0.0" } } }),
      ],
    });
    expect(isDependencyBump(["package.json"], overrides)).toBe(false);
  });

  it("GivenDependencyAddedOrRemoved_WhenChecked_ThenFalse", () => {
    const added = reader({
      "package.json": [pkg({ a: "1.0.0" }), pkg({ a: "1.0.0", b: "1.0.0" })],
    });
    expect(isDependencyBump(["package.json"], added)).toBe(false);
    const removed = reader({
      "package.json": [pkg({ a: "1.0.0", b: "1.0.0" }), pkg({ a: "1.0.0" })],
    });
    expect(isDependencyBump(["package.json"], removed)).toBe(false);
  });

  it("GivenNewOrDeletedManifest_WhenChecked_ThenFalse", () => {
    expect(
      isDependencyBump(
        ["packages/new/package.json"],
        reader({ "packages/new/package.json": [null, pkg({})] }),
      ),
    ).toBe(false);
  });

  it("GivenAlwaysReviewedFolders_WhenChecked_ThenFalse", () => {
    for (const path of [
      ".github/package.json",
      "infra/x/package.json",
      "platform/actions/x/package-lock.json",
      "template/starter/package.json",
    ]) {
      expect(isDependencyBump([path], reader({ [path]: [pkg({}), pkg({})] }))).toBe(false);
    }
  });

  it("GivenAnyOtherFile_WhenChecked_ThenFalse", () => {
    expect(isDependencyBump(["pnpm-lock.yaml", "apps/web/src/App.tsx"], reader({}))).toBe(false);
    expect(isDependencyBump(["pnpm-lock.yaml", ".npmrc"], reader({}))).toBe(false);
    expect(isDependencyBump(["pnpm-lock.yaml", "pnpm-workspace.yaml"], reader({}))).toBe(false);
  });

  it("GivenNoFiles_WhenChecked_ThenFalse", () => {
    expect(isDependencyBump([""], reader({}))).toBe(false);
  });
});

describe("dependencyBumpOutput", () => {
  it("GivenUnparsableManifest_WhenChecked_ThenFalse", () => {
    const read = () => "{ not json";
    expect(dependencyBumpOutput(() => ["package.json"], read)).toBe("false");
  });

  it("GivenDetectionThrows_WhenChecked_ThenFalse", () => {
    const list = () => {
      throw new Error("git failed");
    };
    expect(dependencyBumpOutput(list, () => null)).toBe("false");
  });

  it("GivenUnknownBaseRef_WhenCheckedThroughGit_ThenFalse", () => {
    expect(dependencyBumpOutput(() => changedPaths("no-such-ref-ai-394"), fileAt)).toBe("false");
  });

  it("GivenUnknownRef_WhenFileRead_ThenNull", () => {
    expect(fileAt("no-such-ref-ai-394", "package.json")).toBeNull();
  });
});
