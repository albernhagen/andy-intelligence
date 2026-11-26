import { describe, expect, it } from "vitest";
import { buildProject } from "../ports/work-tracker-support";
import { Project, ProjectSettings } from "../index";

/** AI-388: which open PRs are kept up to date (ADR-0157). */
describe("PR sync setting", () => {
  it("GivenANewProject_WhenBuilt_ThenOnlyTheQueuesNextPrIsSynced", () => {
    expect(buildProject({ name: "AI", key: "AI" }).prSync).toBe("queue");
  });

  it("GivenAProjectStoredBeforeTheSetting_WhenRead_ThenItReadsAsQueue", () => {
    const older: Partial<Project> = buildProject({ name: "AI", key: "AI" });
    delete older.prSync;
    expect(Project.parse(older).prSync).toBe("queue");
  });

  it("GivenAnUnknownValue_WhenParsed_ThenRejected", () => {
    const project = { ...buildProject({ name: "AI", key: "AI" }), prSync: "none" };
    expect(Project.safeParse(project).success).toBe(false);
    expect(ProjectSettings.safeParse({ prSync: "some" }).success).toBe(false);
  });

  it("GivenAll_WhenParsedAsASetting_ThenAccepted", () => {
    expect(ProjectSettings.parse({ prSync: "all" })).toEqual({ prSync: "all" });
  });
});
