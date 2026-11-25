import { describe, expect, it } from "vitest";
import { changedPaths, gateOutput, isDocsOnly } from "./review-scope.mjs";

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
