import { describe, expect, it } from "vitest";
import { buildProject } from "../ports/work-tracker-support";
import { Project } from "./index";

/** AI-160: M6.2: the per-project release environment policy (ADR-0050). */
describe("environment policy", () => {
  it("GivenANewProject_WhenBuilt_ThenItIsProdOnly", () => {
    expect(buildProject({ name: "AI", key: "AI" }).environments).toBe("prod-only");
  });

  it("GivenAProjectStoredBeforeTheSetting_WhenRead_ThenItIsProdOnly", () => {
    const older: Partial<Project> = buildProject({ name: "AI", key: "AI" });
    delete older.environments;
    expect(Project.parse(older).environments).toBe("prod-only");
  });

  it("GivenAnUnknownPolicy_WhenParsed_ThenRejected", () => {
    const project = { ...buildProject({ name: "AI", key: "AI" }), environments: "staging" };
    expect(Project.safeParse(project).success).toBe(false);
  });
});
