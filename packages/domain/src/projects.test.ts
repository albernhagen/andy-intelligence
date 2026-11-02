import { InMemoryCodeHost, InMemoryWorkTracker } from "@andy/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { ProjectService, projectForRepo } from "./projects";

const repo = (fullName: string) => ({
  fullName,
  defaultBranch: "main",
  private: false,
  url: `https://github.com/${fullName}`,
});

describe("ProjectService", () => {
  let tracker: InMemoryWorkTracker;
  let host: InMemoryCodeHost;
  let service: ProjectService;

  beforeEach(() => {
    tracker = new InMemoryWorkTracker();
    host = new InMemoryCodeHost([repo("albernhagen/andy-intelligence")]);
    service = new ProjectService(tracker, host);
  });

  const rejects = (p: Promise<unknown>, code: string) =>
    expect(p).rejects.toMatchObject({ name: "DomainError", code });

  it("GivenAnInstalledRepo_WhenRegistered_ThenTheProjectStoresTheHostSpelling", async () => {
    const project = await service.register({
      name: "andy-intelligence",
      key: "AI",
      repos: ["ALBERNHAGEN/Andy-Intelligence"],
    });
    expect(project.repos).toEqual(["albernhagen/andy-intelligence"]);
    expect(await tracker.getProject("ai")).toEqual(project);
  });

  it("GivenARepoWithoutTheApp_WhenRegistered_ThenInvalidRepoAndNothingIsCreated", async () => {
    await rejects(
      service.register({ name: "x", key: "X", repos: ["albernhagen/other"] }),
      "invalid_repo",
    );
    expect(await tracker.listProjects()).toEqual([]);
  });

  it("GivenAMalformedRepo_WhenRegistered_ThenInvalidRepo", async () => {
    await rejects(service.register({ name: "x", key: "X", repos: ["nope"] }), "invalid_repo");
  });

  it("GivenARepoOfAnotherProject_WhenRegistered_ThenRepoTaken", async () => {
    await service.register({ name: "a", key: "A", repos: ["albernhagen/andy-intelligence"] });
    await rejects(
      service.register({ name: "b", key: "B", repos: ["Albernhagen/andy-intelligence"] }),
      "repo_taken",
    );
  });

  it("GivenTheSameRepoTwice_WhenRegistered_ThenItIsStoredOnce", async () => {
    const project = await service.register({
      name: "a",
      key: "A",
      repos: ["albernhagen/andy-intelligence", "albernhagen/Andy-Intelligence"],
    });
    expect(project.repos).toEqual(["albernhagen/andy-intelligence"]);
  });

  it("GivenNoCodeHost_WhenRegistered_ThenReposAreOnlyFormatChecked", async () => {
    const local = new ProjectService(tracker, null);
    const project = await local.register({ name: "a", key: "A", repos: ["me/anything"] });
    expect(project.repos).toEqual(["me/anything"]);
  });

  it("GivenNoRepos_WhenRegistered_ThenTheProjectIsCreated", async () => {
    expect((await service.register({ name: "a", key: "A" })).repos).toEqual([]);
  });
});

describe("projectForRepo", () => {
  it("GivenProjects_WhenLookedUpByRepo_ThenTheOwnerIsFoundCaseInsensitively", async () => {
    const tracker = new InMemoryWorkTracker();
    const a = await tracker.createProject({ name: "a", key: "A", repos: ["me/one"] });
    const projects = [a];
    expect(projectForRepo(projects, "ME/One")).toEqual(a);
    expect(projectForRepo(projects, "me/two")).toBeNull();
  });
});
