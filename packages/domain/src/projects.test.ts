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

  it.each(["agent:r1", "system"])(
    "GivenTheActor%s_WhenChangingSettings_ThenForbiddenAndNothingChanges",
    async (actor) => {
      await tracker.createProject({ name: "AI", key: "AI" });
      await rejects(
        service.update("ai", { paused: true }, { actor, email: "andy@example.com" }),
        "forbidden",
      );
      expect((await tracker.getProject("ai"))?.paused).toBe(false);
    },
  );

  it("GivenAndy_WhenHeMarksASetupStepDone_ThenItIsStoredWithWhoAndWhen", async () => {
    await tracker.createProject({ name: "AI", key: "AI" });
    const at = new Date("2026-11-25T12:00:00.000Z");
    const marking = new ProjectService(tracker, host, null, () => at);

    await marking.markSetupStep("ai", "reviewer_token", true, {
      actor: "user:andy",
      email: "andy@example.com",
    });

    expect((await tracker.getProject("ai"))?.setupMarks).toEqual({
      reviewer_token: { by: "andy@example.com", at: at.toISOString() },
    });
  });

  it("GivenAMarkedStep_WhenUnmarked_ThenTheMarkIsGone", async () => {
    await tracker.createProject({ name: "AI", key: "AI" });
    const by = { actor: "user:andy", email: "andy@example.com" };
    await service.markSetupStep("ai", "reviewer_token", true, by);

    await service.markSetupStep("ai", "reviewer_token", false, by);

    expect((await tracker.getProject("ai"))?.setupMarks).toEqual({});
  });

  it.each(["agent:r1", "system"])(
    "GivenTheActor%s_WhenMarkingASetupStep_ThenForbidden",
    async (actor) => {
      await tracker.createProject({ name: "AI", key: "AI" });
      await rejects(
        service.markSetupStep("ai", "reviewer_token", true, { actor, email: "x@example.com" }),
        "forbidden",
      );
    },
  );

  it("GivenAnInstalledRepo_WhenRegistered_ThenTheProjectStoresTheHostSpelling", async () => {
    const project = await service.register(
      {
        name: "andy-intelligence",
        key: "AI",
        repos: ["ALBERNHAGEN/Andy-Intelligence"],
      },
      "andy",
    );
    expect(project.repos).toEqual(["albernhagen/andy-intelligence"]);
    expect(await tracker.getProject("ai")).toEqual(project);
  });

  it("GivenARepoWithoutTheApp_WhenRegistered_ThenInvalidRepoAndNothingIsCreated", async () => {
    await rejects(
      service.register({ name: "x", key: "X", repos: ["albernhagen/other"] }, "andy"),
      "invalid_repo",
    );
    expect(await tracker.listProjects()).toEqual([]);
  });

  it("GivenAMalformedRepo_WhenRegistered_ThenInvalidRepo", async () => {
    await rejects(
      service.register({ name: "x", key: "X", repos: ["nope"] }, "andy"),
      "invalid_repo",
    );
  });

  it("GivenARepoOfAnotherProject_WhenRegistered_ThenRepoTaken", async () => {
    await service.register(
      { name: "a", key: "A", repos: ["albernhagen/andy-intelligence"] },
      "andy",
    );
    await rejects(
      service.register({ name: "b", key: "B", repos: ["Albernhagen/andy-intelligence"] }, "andy"),
      "repo_taken",
    );
  });

  it("GivenTheSameRepoTwice_WhenRegistered_ThenItIsStoredOnce", async () => {
    const project = await service.register(
      {
        name: "a",
        key: "A",
        repos: ["albernhagen/andy-intelligence", "albernhagen/Andy-Intelligence"],
      },
      "andy",
    );
    expect(project.repos).toEqual(["albernhagen/andy-intelligence"]);
  });

  it("GivenNoCodeHost_WhenRegistered_ThenReposAreOnlyFormatChecked", async () => {
    const local = new ProjectService(tracker, null);
    const project = await local.register({ name: "a", key: "A", repos: ["me/anything"] }, "andy");
    expect(project.repos).toEqual(["me/anything"]);
  });

  it("GivenRegisteredRepos_WhenTheProjectIsStored_ThenTheReposHookRunsOnceWithTheStoredProject", async () => {
    host.install(repo("albernhagen/web"));
    const calls: string[][] = [];
    const hooked = new ProjectService(
      tracker,
      host,
      null,
      undefined,
      null,
      undefined,
      undefined,
      async (project) => {
        expect(await tracker.getProject(project.id)).not.toBeNull();
        calls.push(project.repos);
      },
    );
    await hooked.register(
      { name: "a", key: "A", repos: ["albernhagen/andy-intelligence", "albernhagen/web"] },
      "andy",
    );
    await hooked.register({ name: "b", key: "B" }, "andy");
    expect(calls).toEqual([["albernhagen/andy-intelligence", "albernhagen/web"]]);
  });

  it("GivenARepoHookThatThrows_WhenRegistered_ThenTheProjectIsStillCreated", async () => {
    const hooked = new ProjectService(
      tracker,
      host,
      null,
      undefined,
      null,
      undefined,
      undefined,
      async () => {
        throw new Error("boom");
      },
    );
    const project = await hooked.register(
      { name: "a", key: "A", repos: ["albernhagen/andy-intelligence"] },
      "andy",
    );
    expect(await tracker.getProject(project.id)).toEqual(project);
  });

  it("GivenNoRepos_WhenRegistered_ThenTheProjectIsCreated", async () => {
    expect((await service.register({ name: "a", key: "A" }, "andy")).repos).toEqual([]);
  });

  it("GivenANonOwner_WhenItRegistersAProject_ThenForbiddenAndNothingIsCreated", async () => {
    await expect(service.register({ name: "a", key: "A" }, "agent:run-1")).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await tracker.listProjects()).toEqual([]);
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
