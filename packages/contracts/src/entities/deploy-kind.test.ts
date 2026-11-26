import { describe, expect, it } from "vitest";
import { buildProject } from "../ports/work-tracker-support";
import { Project, ProjectSettings } from "../index";

/** AI-387: M6.21: how a project ships (ADR-0114). */
describe("deploy kind", () => {
  it("GivenANewProject_WhenBuilt_ThenItDoesNotDeploy", () => {
    expect(buildProject({ name: "AI", key: "AI" }).deployKind).toBe("none");
  });

  it("GivenAProjectStoredBeforeTheSetting_WhenRead_ThenItDoesNotDeploy", () => {
    const older: Partial<Project> = buildProject({ name: "AI", key: "AI" });
    delete older.deployKind;
    expect(Project.parse(older).deployKind).toBe("none");
  });

  it("GivenAnUnknownKind_WhenParsed_ThenRejected", () => {
    const project = { ...buildProject({ name: "AI", key: "AI" }), deployKind: "vercel" };
    expect(Project.safeParse(project).success).toBe(false);
    expect(ProjectSettings.safeParse({ deployKind: "deploy" }).success).toBe(false);
  });

  it("GivenCloudRun_WhenParsedAsASetting_ThenAccepted", () => {
    expect(ProjectSettings.parse({ deployKind: "cloud-run" })).toEqual({ deployKind: "cloud-run" });
  });
});
