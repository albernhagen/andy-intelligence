import {
  InMemoryConfigChangeStore,
  InMemoryWorkTracker,
  type ConfigChange,
  type Project,
} from "@andy/contracts";
import { configChangeLogContract } from "@andy/contracts/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeActor, projectSettingsChange, settingsDiff } from "./config-changes";
import { ProjectService } from "./projects";

const OWNER = { actor: "andy" as const, email: "andy@example.com" };

// The fake passes the same suite as the Firestore adapter (`packages/store`, emulator).
configChangeLogContract("in-memory", async () => new InMemoryConfigChangeStore());

describe("settingsDiff", () => {
  const project = {
    id: "ai",
    autoBuild: false,
    buildEnabled: true,
    runsAtOnce: 2,
    buildEnabledBy: "andy@example.com",
  } as unknown as Project;

  it("GivenChangedSettings_WhenDiffed_ThenOnlyThoseFieldsWithBeforeAndAfter", () => {
    const after = { ...project, autoBuild: true, runsAtOnce: 3 } as Project;
    expect(settingsDiff(project, after)).toEqual({
      autoBuild: { from: false, to: true },
      runsAtOnce: { from: 2, to: 3 },
    });
  });

  it("GivenOnlyWhoAndWhenChanged_WhenDiffed_ThenNothingDiffers", () => {
    const after = { ...project, buildEnabledBy: "x@example.com", updatedAt: "now" } as Project;
    expect(settingsDiff(project, after)).toEqual({});
  });
});

describe("changeActor", () => {
  it.each([
    ["andy", "andy"],
    ["user:uid-1", "andy"],
    ["agent:run-1", "agent"],
  ] as const)("GivenTheEventActor%s_WhenMapped_ThenItIs%s", (actor, expected) => {
    expect(changeActor(actor)).toBe(expected);
  });
});

describe("projectSettingsChange", () => {
  const before = { id: "ai", paused: false } as unknown as Project;
  const at = new Date("2026-11-12T10:00:00.000Z");

  it("GivenAChange_WhenBuilt_ThenItIsAnAppliedProjectChangeWithTheReason", () => {
    const change = projectSettingsChange({
      id: "c1",
      before,
      after: { ...before, paused: true },
      actor: "andy",
      reason: "  night off ",
      at,
    });
    expect(change).toEqual({
      id: "c1",
      entity: "project",
      entityId: "ai",
      projectId: "ai",
      diff: { paused: { from: false, to: true } },
      actor: "andy",
      reason: "night off",
      status: "applied",
      createdAt: at.toISOString(),
      appliedAt: at.toISOString(),
      dedupeKey: null,
      decidedBy: null,
      decidedAt: null,
    });
  });

  it("GivenNoChange_WhenBuilt_ThenNull", () => {
    expect(projectSettingsChange({ id: "c1", before, after: before, actor: "andy", at })).toBe(
      null,
    );
  });
});

describe("ProjectService config change log (M4.11)", () => {
  let tracker: InMemoryWorkTracker;
  let changes: InMemoryConfigChangeStore;
  let service: ProjectService;
  let ids: number;
  const now = () => new Date("2026-11-12T10:00:00.000Z");
  const logged = (changeList: ConfigChange[]) => changeList.map((c) => c.diff);

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tracker = new InMemoryWorkTracker();
    changes = new InMemoryConfigChangeStore();
    ids = 0;
    service = new ProjectService(tracker, null, null, now, changes, () => `change-${++ids}`);
    await tracker.createProject({ name: "AI", key: "AI", repos: ["a/b"] });
  });

  it("GivenASettingsWrite_WhenItChangesFields_ThenOneAppliedChangeWithTheirBeforeAndAfterAndTheActor", async () => {
    await service.update("ai", { runsAtOnce: 3, paused: true }, OWNER, "testing");
    const [change] = await changes.listForProject("ai");
    expect(change).toMatchObject({
      id: "change-1",
      entity: "project",
      entityId: "ai",
      actor: "andy",
      reason: "testing",
      status: "applied",
      diff: { runsAtOnce: { from: 2, to: 3 }, paused: { from: false, to: true } },
    });
    expect(Object.keys(change!.diff)).toEqual(["runsAtOnce", "paused"]);
  });

  it("GivenASettingsWrite_WhenNothingChanges_ThenNoChangeIsAppended", async () => {
    const project = (await tracker.getProject("ai"))!;
    await service.update("ai", { runsAtOnce: project.runsAtOnce }, OWNER);
    await service.update("ai", {}, OWNER);
    expect(await changes.listForProject("ai")).toEqual([]);
  });

  it("GivenBuildsTurnedOff_WhenWritten_ThenTheAutoBuildItSwitchesOffIsInTheDiffButNotWhoOrWhen", async () => {
    await tracker.updateProject("ai", { buildEnabled: true, autoBuild: true });
    await service.update("ai", { buildEnabled: false }, OWNER);
    expect(logged(await changes.listForProject("ai"))).toEqual([
      { buildEnabled: { from: true, to: false }, autoBuild: { from: true, to: false } },
    ]);
  });

  it("GivenTwoWrites_WhenListed_ThenEachIsItsOwnChange", async () => {
    await service.update("ai", { paused: true }, { actor: "user:uid-1", email: OWNER.email });
    await service.update("ai", { paused: false }, OWNER);
    expect((await changes.listForProject("ai")).map((c) => c.id).sort()).toEqual([
      "change-1",
      "change-2",
    ]);
  });

  it("GivenTheLogFails_WhenASettingIsWritten_ThenTheWriteStandsAndAnErrorIsLogged", async () => {
    vi.spyOn(changes, "append").mockRejectedValue(new Error("unavailable"));
    const updated = await service.update("ai", { paused: true }, OWNER);
    expect(updated.paused).toBe(true);
    const errors = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => JSON.parse(String(line)) as { severity: string; message: string })
      .filter((l) => l.severity === "ERROR");
    expect(errors).toEqual([
      expect.objectContaining({
        message: "config change not recorded",
        configChangeId: "change-1",
      }),
    ]);
  });

  it("GivenARefusedWrite_WhenItThrows_ThenNoChangeIsAppended", async () => {
    await expect(service.update("ai", { autoBuild: true }, OWNER)).rejects.toMatchObject({
      code: "not_buildable",
    });
    expect(await changes.listForProject("ai")).toEqual([]);
  });

  it("GivenNoLogConfigured_WhenASettingIsWritten_ThenItIsAppliedAsBefore", async () => {
    const plain = new ProjectService(tracker, null);
    expect((await plain.update("ai", { paused: true }, OWNER)).paused).toBe(true);
  });
});
