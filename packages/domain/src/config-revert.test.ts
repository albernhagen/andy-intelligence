import {
  ConfigChange,
  InMemoryConfigChangeStore,
  InMemoryWorkTracker,
  type Project,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { revertPatch, revertRefusal } from "./config-changes";
import { ConfigRevert } from "./config-revert";
import { ProjectService } from "./projects";

const OWNER = { actor: "user:uid-1" as const, email: "andy@example.com" };
const AGENT = { actor: "agent:run-1" as const, email: "" };

const applied = (overrides: Partial<ConfigChange> = {}): ConfigChange =>
  ConfigChange.parse({
    id: "c1",
    entity: "project",
    entityId: "ai",
    projectId: "ai",
    diff: { paused: { from: false, to: true } },
    actor: "andy",
    reason: "",
    status: "applied",
    createdAt: "2026-11-12T10:00:00.000Z",
    appliedAt: "2026-11-12T10:00:00.000Z",
    ...overrides,
  });

describe("revertPatch", () => {
  it("GivenAnAppliedChange_WhenReverted_ThenEachFieldGoesBackToItsBeforeValue", () => {
    const change = applied({
      diff: { buildEnabled: { from: true, to: false }, autoBuild: { from: true, to: false } },
    });
    expect(revertPatch(change)).toEqual({ buildEnabled: true, autoBuild: true });
  });

  it.each(["reverted", "pending", "rejected"] as const)(
    "GivenA%sChange_WhenReverted_ThenNotRevertible",
    (status) => {
      expect(() => revertPatch(applied({ status }))).toThrow(
        expect.objectContaining({ code: "not_revertible" }),
      );
    },
  );

  it("GivenBeforeValuesThatArentSettings_WhenReverted_ThenNotRevertible", () => {
    expect(() => revertPatch(applied({ diff: { runsAtOnce: { from: null, to: 2 } } }))).toThrow(
      expect.objectContaining({ code: "not_revertible" }),
    );
    expect(() => revertPatch(applied({ entity: "tier" }))).toThrow(
      expect.objectContaining({ code: "not_revertible" }),
    );
  });
});

describe("revertRefusal", () => {
  const project = { id: "ai", paused: true, runsAtOnce: 2 } as unknown as Project;

  it("GivenNothingChangedSince_WhenChecked_ThenNull", () => {
    const change = applied();
    const older = applied({ id: "c0", createdAt: "2026-11-12T09:00:00.000Z" });
    expect(revertRefusal(change, project, [change, older])).toBeNull();
  });

  it("GivenANewerChangeOfTheSameField_WhenChecked_ThenRefusedNamingTheNewest", () => {
    const change = applied();
    const newer = applied({ id: "c2", createdAt: "2026-11-12T11:00:00.000Z" });
    const newest = applied({ id: "c3", createdAt: "2026-11-12T12:00:00.000Z" });
    const other = applied({
      id: "c4",
      createdAt: "2026-11-12T13:00:00.000Z",
      diff: { runsAtOnce: { from: 1, to: 2 } },
    });
    const refusal = revertRefusal(change, project, [other, newest, newer, change]);
    expect(refusal?.code).toBe("not_revertible");
    expect(refusal?.message).toContain("c3");
    expect(refusal?.message).toContain("paused");
  });

  it("GivenAChangeOfTheSameFieldInTheSameMillisecond_WhenChecked_ThenRefused", () => {
    const tie = applied({ id: "c2" });
    expect(revertRefusal(applied(), project, [tie, applied()])?.message).toContain("c2");
  });

  it("GivenAFieldChangedOutsideTheLog_WhenChecked_ThenRefused", () => {
    const refusal = revertRefusal(applied(), { ...project, paused: false }, [applied()]);
    expect(refusal?.message).toContain("not in the change log");
  });
});

describe("ConfigRevert (M4.12)", () => {
  let tracker: InMemoryWorkTracker;
  let changes: InMemoryConfigChangeStore;
  let projects: ProjectService;
  let revert: ConfigRevert;
  let minute: number;
  let ids: number;
  const now = () => new Date(Date.parse("2026-11-12T10:00:00.000Z") + minute++ * 60_000);

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tracker = new InMemoryWorkTracker();
    changes = new InMemoryConfigChangeStore();
    minute = 0;
    ids = 0;
    projects = new ProjectService(tracker, null, null, now, changes, () => `change-${++ids}`);
    revert = new ConfigRevert(tracker, projects, changes, now);
    await tracker.createProject({ name: "AI", key: "AI", repos: ["a/b"] });
  });

  it("GivenAFlip_WhenTheOwnerReverts_ThenTheSettingIsBackTheOriginalRevertedAndTheRevertLogged", async () => {
    await projects.update("ai", { paused: true }, OWNER);
    const result = await revert.revert("ai", "change-1", OWNER, "app");

    expect(result.project.paused).toBe(false);
    expect(result.reverted).toMatchObject({
      id: "change-1",
      status: "reverted",
      decidedBy: OWNER.actor,
    });
    const [latest, original] = await revert.list("ai");
    expect(original?.status).toBe("reverted");
    expect(latest).toMatchObject({
      id: "change-2",
      status: "applied",
      reason: "Revert of change-1",
      diff: { paused: { from: true, to: false } },
    });
  });

  it("GivenBuildsTurnedOff_WhenReverted_ThenBuildsAndAutoBuildAreBackOn", async () => {
    await tracker.updateProject("ai", { buildEnabled: true, autoBuild: true });
    await projects.update("ai", { buildEnabled: false }, OWNER);
    const { project } = await revert.revert("ai", "change-1", OWNER, "app");
    expect(project).toMatchObject({ buildEnabled: true, autoBuild: true });
  });

  it("GivenTheFieldChangedAgain_WhenReverted_ThenRefusedNamingTheNewerChangeAndNothingWritten", async () => {
    await projects.update("ai", { paused: true }, OWNER);
    await projects.update("ai", { paused: false }, OWNER);
    await expect(revert.revert("ai", "change-1", OWNER, "app")).rejects.toMatchObject({
      code: "not_revertible",
      message: expect.stringContaining("change-2"),
    });
    expect((await changes.get("change-1"))?.status).toBe("applied");
    expect(await revert.list("ai")).toHaveLength(2);
  });

  it("GivenARevertedChange_WhenRevertedAgain_ThenRefused", async () => {
    await projects.update("ai", { paused: true }, OWNER);
    await revert.revert("ai", "change-1", OWNER, "app");
    await expect(revert.revert("ai", "change-1", OWNER, "app")).rejects.toMatchObject({
      code: "not_revertible",
    });
  });

  it("GivenANonOwner_WhenReverting_ThenForbiddenByThePermissionFunction", async () => {
    await projects.update("ai", { paused: true }, OWNER);
    await expect(revert.revert("ai", "change-1", AGENT, "app")).rejects.toMatchObject({
      code: "forbidden",
    });
    expect((await tracker.getProject("ai"))?.paused).toBe(true);
  });

  it("GivenABuildsChange_WhenRevertedOverMcp_ThenRefusedAsBuildsIsSetOnlyInTheApp", async () => {
    await tracker.updateProject("ai", { buildEnabled: true });
    await projects.update("ai", { buildEnabled: false }, OWNER);
    await expect(revert.revert("ai", "change-1", OWNER, "mcp")).rejects.toMatchObject({
      code: "not_revertible",
      details: [expect.stringContaining("only in the app")],
    });
  });

  it("GivenAnotherProjectsOrUnknownChange_WhenReverted_ThenNotFound", async () => {
    await tracker.createProject({ name: "Ops", key: "OPS", repos: ["a/c"] });
    await projects.update("ops", { paused: true }, OWNER);
    await expect(revert.revert("ai", "change-1", OWNER, "app")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(revert.revert("ai", "missing", OWNER, "app")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(revert.list("none")).rejects.toMatchObject({ code: "not_found" });
  });

  it("GivenMarkingFailedOnce_WhenRetried_ThenTheMarkCompletesWithoutWritingAgain", async () => {
    await projects.update("ai", { paused: true }, OWNER);
    vi.spyOn(changes, "markReverted").mockRejectedValueOnce(new Error("unavailable"));
    await expect(revert.revert("ai", "change-1", OWNER, "app")).rejects.toThrow("unavailable");

    const retried = await revert.revert("ai", "change-1", OWNER, "app");

    expect(retried.reverted.status).toBe("reverted");
    expect(retried.project.paused).toBe(false);
    expect(await revert.list("ai")).toHaveLength(2);
  });

  it("GivenTwoRevertsAtOnce_WhenBothRun_ThenOneSucceedsAndTheOtherIsA409NotAnError", async () => {
    await projects.update("ai", { paused: true }, OWNER);

    const results = await Promise.allSettled([
      revert.revert("ai", "change-1", OWNER, "app"),
      revert.revert("ai", "change-1", OWNER, "mcp"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "not_revertible" },
    });
    expect((await tracker.getProject("ai"))?.paused).toBe(false);
    const errors = vi
      .mocked(console.log)
      .mock.calls.filter(([line]) => String(line).includes('"severity":"ERROR"'));
    expect(errors).toEqual([]);
  });

  it("GivenMarkingFails_WhenReverted_ThenTheErrorIsLoggedAndSurfaced", async () => {
    await projects.update("ai", { paused: true }, OWNER);
    vi.spyOn(changes, "markReverted").mockRejectedValue(new Error("unavailable"));
    await expect(revert.revert("ai", "change-1", OWNER, "app")).rejects.toThrow("unavailable");
    const errors = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => JSON.parse(String(line)) as { severity: string; message: string })
      .filter((l) => l.severity === "ERROR");
    expect(errors).toEqual([
      expect.objectContaining({ message: "config change not marked reverted" }),
    ]);
  });
});
