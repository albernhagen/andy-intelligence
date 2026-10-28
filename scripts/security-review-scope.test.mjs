import { describe, expect, it } from "vitest";
import { isDocsOnly } from "./security-review-scope.mjs";

describe("isDocsOnly", () => {
  it("GivenOnlyDocsAndReadmes_WhenChecked_ThenTrue", () => {
    expect(isDocsOnly(["docs/build-log.md", "README.md", "apps/api/README.md", ""])).toBe(true);
  });

  it("GivenAnyCodeOrWorkflowFile_WhenChecked_ThenFalse", () => {
    expect(isDocsOnly(["docs/build-log.md", "scripts/security-review-gate.mjs"])).toBe(false);
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
