import {
  DEFAULT_ROUTING,
  InMemoryConfigChangeStore,
  InMemoryRoutingConfigStore,
  InMemoryWorkTracker,
  type ConfigChangeLog,
  type Route,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROUTING_VIEW_MAX_PROJECTS,
  RoutingSettings,
  widerThanGlobal,
  type RoutingFields,
} from "./routing-settings";

const OWNER = "user:uid-1" as const;
const T0 = new Date("2026-11-21T10:00:00.000Z");
const fields = (): RoutingFields =>
  structuredClone({
    providers: DEFAULT_ROUTING.providers,
    tiers: DEFAULT_ROUTING.tiers,
    steps: DEFAULT_ROUTING.steps,
  });
const jules: Route = { harness: "jules", provider: "google-sub", model: "jules" };

async function setup(changes: ConfigChangeLog = new InMemoryConfigChangeStore()) {
  const tracker = new InMemoryWorkTracker();
  await tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  // A second per call, so each save and its change get their own time.
  let tick = 0;
  const now = () => new Date(T0.getTime() + 1000 * tick++);
  const store = new InMemoryRoutingConfigStore(now);
  let n = 0;
  const settings = new RoutingSettings(store, tracker, changes, now, () => `change-${++n}`);
  return { settings, store, changes };
}

describe("RoutingSettings", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenNothingStored_WhenRead_ThenTheDefaultsAndAProjectFollowsThem", async () => {
    const { settings } = await setup();
    expect((await settings.global()).tiers.fast).toEqual(DEFAULT_ROUTING.tiers.fast);
    expect(await settings.project("ai")).toEqual({
      projectId: "ai",
      config: null,
      effective: DEFAULT_ROUTING,
    });
  });

  it("GivenJulesOnClaudeSub_WhenSaved_ThenRefusedNamingTheRouteAndNothingStored", async () => {
    const { settings, store } = await setup();
    const bad = fields();
    bad.tiers.fast = [{ harness: "jules", provider: "claude-sub", model: "jules" }];
    await expect(settings.putGlobal(bad, null, OWNER)).rejects.toMatchObject({
      code: "invalid_field",
      details: [
        "tier fast, route 1: harness jules doesn't run on provider claude-sub (it needs google-sub)",
      ],
    });
    expect((await store.getGlobal()).updatedAt).toBeNull();
  });

  it("GivenAnAcceptedGlobalSave_WhenSaved_ThenOneConfigChangeNamesWhoAndWhat", async () => {
    const { settings, changes } = await setup();
    const next = fields();
    next.providers["google-sub"].enabled = true;
    next.tiers.cheap = [jules];
    await settings.putGlobal(next, null, OWNER, "try Jules on cheap");
    const logged = await (changes as InMemoryConfigChangeStore).get("change-1");
    expect(logged).toMatchObject({
      entity: "routing",
      entityId: "global",
      projectId: null,
      actor: "andy",
      reason: "try Jules on cheap",
      status: "applied",
    });
    expect(Object.keys(logged!.diff).sort()).toEqual(["providers", "tiers"]);
  });

  it("GivenAProjectSave_WhenAccepted_ThenItShowsInThatProjectsChangeLog", async () => {
    const { settings, changes } = await setup();
    const narrower = fields();
    narrower.providers["claude-sub"].pausePct = 60;
    narrower.providers["claude-sub"].warnPct = 50;
    await settings.putProject("ai", narrower, null, OWNER);
    const log = await changes.listForProject("ai");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity: "routing", entityId: "ai", projectId: "ai" });
    expect((await settings.project("ai")).effective.providers["claude-sub"].pausePct).toBe(60);
  });

  it("GivenAProjectEnablingAProviderGlobalDisables_WhenSaved_ThenRefused", async () => {
    const { settings } = await setup();
    const wider = fields();
    wider.providers["google-sub"].enabled = true;
    await expect(settings.putProject("ai", wider, null, OWNER)).rejects.toMatchObject({
      code: "invalid_field",
      details: ["provider google-sub is off globally"],
    });
  });

  it("GivenAnUnchangedSave_WhenSaved_ThenNoConfigChange", async () => {
    const { settings, changes } = await setup();
    const saved = await settings.putGlobal(fields(), null, OWNER);
    await settings.putGlobal(fields(), saved.updatedAt, OWNER);
    // The first save changed nothing either: the stored global equals the defaults.
    expect(await (changes as InMemoryConfigChangeStore).get("change-1")).toBeNull();
  });

  it.each(["agent:run-1", "system"] as const)(
    "GivenTheCaller%s_WhenSaving_ThenForbidden",
    async (actor) => {
      const { settings } = await setup();
      await expect(settings.putGlobal(fields(), null, actor)).rejects.toMatchObject({
        code: "forbidden",
      });
      await expect(settings.setTierRoutes("ai", "fast", [], actor)).rejects.toMatchObject({
        code: "forbidden",
      });
    },
  );

  it("GivenAStaleRead_WhenSaved_ThenConflict", async () => {
    const { settings } = await setup();
    const next = fields();
    next.steps.refine = "cheap";
    await settings.putGlobal(next, null, OWNER);
    await expect(settings.putGlobal(fields(), null, OWNER)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("GivenATierEdit_WhenSetForAProjectWithoutAConfig_ThenItStartsFromGlobal", async () => {
    const { settings } = await setup();
    const saved = await settings.setTierRoutes(
      "ai",
      "fast",
      [{ harness: "claude-code", provider: "claude-sub", model: "sonnet" }],
      OWNER,
    );
    expect(saved.scope).toBe("project");
    expect(saved.steps).toEqual(DEFAULT_ROUTING.steps);
  });

  it("GivenAProjectRouteGlobalDoesntList_WhenSet_ThenRefused", async () => {
    const { settings } = await setup();
    await expect(
      settings.setTierRoutes(
        "ai",
        "fast",
        [{ harness: "claude-code", provider: "claude-sub", model: "opus" }],
        OWNER,
      ),
    ).rejects.toMatchObject({ code: "invalid_field" });
  });

  it("GivenTheChangeLogFails_WhenSaved_ThenTheSaveStandsAndAnErrorIsLogged", async () => {
    const failing = new InMemoryConfigChangeStore();
    vi.spyOn(failing, "append").mockRejectedValue(new Error("down"));
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const { settings, store } = await setup(failing);
    const next = fields();
    next.steps.refine = "cheap";
    await settings.putGlobal(next, null, OWNER);
    expect((await store.getGlobal()).steps.refine).toBe("cheap");
    expect(
      logs.mock.calls.some(([line]) => String(line).includes("config change not recorded")),
    ).toBe(true);
  });

  it("GivenAnUnknownProject_WhenReadOrSaved_ThenNotFound", async () => {
    const { settings } = await setup();
    await expect(settings.project("ops")).rejects.toMatchObject({ code: "not_found" });
    await expect(settings.putProject("ops", fields(), null, OWNER)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("RoutingSettings edits and overview", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenMoreProjectsThanTheCap_WhenOverviewed_ThenGlobalOnceAndCappedAndSaysSo", async () => {
    const { settings, store } = await setup();
    const getGlobal = vi.spyOn(store, "getGlobal");
    const ids = Array.from({ length: ROUTING_VIEW_MAX_PROJECTS + 3 }, (_, i) => `p${i}`);
    const view = await settings.overview(ids);
    expect(view.projects).toHaveLength(ROUTING_VIEW_MAX_PROJECTS);
    expect(view.truncated).toBe(true);
    expect(getGlobal).toHaveBeenCalledTimes(1);
  });

  it("GivenAProviderAndAStepTier_WhenSetGlobally_ThenBothSavedAndEachLogged", async () => {
    const { settings, changes } = await setup();
    await settings.setProvider(
      null,
      "google-sub",
      { ...DEFAULT_ROUTING.providers["google-sub"], enabled: true, dailyTaskLimit: 15 },
      OWNER,
    );
    const saved = await settings.setStepTier(null, "review", "cheap", OWNER);
    expect(saved.providers["google-sub"]).toMatchObject({ enabled: true, dailyTaskLimit: 15 });
    expect(saved.steps.review).toBe("cheap");
    expect(await (changes as InMemoryConfigChangeStore).get("change-2")).toMatchObject({
      entityId: "global",
      diff: { steps: expect.anything() },
    });
  });

  it("GivenAProjectTurningOnAProviderGlobalHasOff_WhenSet_ThenRefused", async () => {
    const { settings } = await setup();
    await expect(
      settings.setProvider(
        "ai",
        "google-sub",
        { ...DEFAULT_ROUTING.providers["google-sub"], enabled: true },
        OWNER,
      ),
    ).rejects.toMatchObject({ code: "invalid_field" });
  });
});

describe("RoutingSettings revert and global log (AI-275)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  const cheaperRefine = () => {
    const next = fields();
    next.steps.refine = "cheap";
    return next;
  };

  it("GivenAGlobalChange_WhenReverted_ThenTheConfigIsBackTheRevertIsLoggedAndTheOriginalMarked", async () => {
    const { settings, store, changes } = await setup();
    await settings.putGlobal(cheaperRefine(), null, OWNER);
    const [change] = await settings.globalChanges(OWNER);
    const { config, reverted } = await settings.revert(change!.id, OWNER);
    expect(config.steps.refine).toBe("fast");
    expect((await store.getGlobal()).steps.refine).toBe("fast");
    expect(reverted.status).toBe("reverted");
    const log = await settings.globalChanges(OWNER);
    expect(log.map((c) => c.reason)).toEqual([`Revert of ${change!.id}`, ""]);
    expect(await (changes as InMemoryConfigChangeStore).get(change!.id)).toMatchObject({
      status: "reverted",
    });
  });

  it("GivenALaterChangeToTheSamePart_WhenTheOlderIsReverted_ThenRefusedNamingIt", async () => {
    const { settings } = await setup();
    const first = await settings.putGlobal(cheaperRefine(), null, OWNER);
    const again = cheaperRefine();
    again.steps.review = "cheap";
    await settings.putGlobal(again, first.updatedAt, OWNER);
    const [newer, older] = await settings.globalChanges(OWNER);
    await expect(settings.revert(older!.id, OWNER)).rejects.toMatchObject({
      code: "not_revertible",
      message: expect.stringContaining(`steps changed since, by config change ${newer!.id}`),
    });
  });

  it("GivenAProjectsFirstSave_WhenReverted_ThenRefusedAsThereWasNothingBefore", async () => {
    const { settings, changes } = await setup();
    const narrower = fields();
    narrower.providers["claude-sub"].warnPct = 60;
    await settings.putProject("ai", narrower, null, OWNER);
    const [change] = await changes.listForProject("ai");
    await expect(settings.revert(change!.id, OWNER)).rejects.toMatchObject({
      code: "not_revertible",
      message: expect.stringContaining("was the first save"),
    });
  });

  it("GivenAProjectsSecondSave_WhenReverted_ThenItsBeforeValuesAreBackAndNarrowingChecked", async () => {
    const { settings, changes, store } = await setup();
    const first = fields();
    first.providers["claude-sub"].warnPct = 60;
    const saved = await settings.putProject("ai", first, null, OWNER);
    const second = structuredClone(first);
    second.providers["claude-sub"].warnPct = 50;
    await settings.putProject("ai", second, saved.updatedAt, OWNER);
    const [latest] = await changes.listForProject("ai");
    await settings.revert(latest!.id, OWNER);
    expect((await store.getProject("ai"))?.providers["claude-sub"].warnPct).toBe(60);
  });

  it("GivenMarkingFailedOnce_WhenTheRevertIsRetried_ThenTheMarkCompletesWithoutSavingAgain", async () => {
    const { settings, store, changes } = await setup();
    await settings.putGlobal(cheaperRefine(), null, OWNER);
    const [change] = await settings.globalChanges(OWNER);
    const log = changes as InMemoryConfigChangeStore;
    vi.spyOn(log, "markReverted").mockRejectedValueOnce(new Error("unavailable"));
    await expect(settings.revert(change!.id, OWNER)).rejects.toThrow("unavailable");
    expect((await store.getGlobal()).steps.refine).toBe("fast");
    const saves = (await settings.globalChanges(OWNER)).length;

    const { reverted } = await settings.revert(change!.id, OWNER);
    expect(reverted.status).toBe("reverted");
    expect(await settings.globalChanges(OWNER)).toHaveLength(saves);
  });

  it("GivenAProjectChangeTheCallerCantRead_WhenReverted_ThenNotFoundAndNothingSaved", async () => {
    const { settings, changes, store } = await setup();
    const first = fields();
    first.providers["claude-sub"].warnPct = 60;
    const saved = await settings.putProject("ai", first, null, OWNER);
    const second = structuredClone(first);
    second.providers["claude-sub"].warnPct = 50;
    await settings.putProject("ai", second, saved.updatedAt, OWNER);
    const [latest] = await changes.listForProject("ai");
    await expect(settings.revert(latest!.id, OWNER, async () => false)).rejects.toMatchObject({
      code: "not_found",
    });
    expect((await store.getProject("ai"))?.providers["claude-sub"].warnPct).toBe(50);
  });

  it.each(["agent:run-1", "system"] as const)(
    "GivenTheCaller%s_WhenListingGlobalChanges_ThenForbidden",
    async (actor) => {
      const { settings } = await setup();
      await expect(settings.globalChanges(actor)).rejects.toMatchObject({ code: "forbidden" });
    },
  );

  it("GivenAPartChangedOutsideTheLog_WhenReverted_ThenRefused", async () => {
    const { settings, store } = await setup();
    await settings.putGlobal(cheaperRefine(), null, OWNER);
    const [change] = await settings.globalChanges(OWNER);
    const current = await store.getGlobal();
    await store.put(
      {
        ...current,
        scope: "global",
        projectId: null,
        steps: { ...current.steps, refine: "strong" },
      },
      current.updatedAt,
    );
    await expect(settings.revert(change!.id, OWNER)).rejects.toMatchObject({
      code: "not_revertible",
      message: expect.stringContaining("outside the change log"),
    });
  });

  it.each(["agent:run-1", "system"] as const)(
    "GivenTheCaller%s_WhenReverting_ThenForbidden",
    async (actor) => {
      const { settings } = await setup();
      await settings.putGlobal(cheaperRefine(), null, OWNER);
      const [change] = await settings.globalChanges(OWNER);
      await expect(settings.revert(change!.id, actor)).rejects.toMatchObject({ code: "forbidden" });
    },
  );

  it("GivenAProjectChangeAndASettingsChange_WhenListingGlobal_ThenOnlyGlobalRouting", async () => {
    const { settings, changes } = await setup();
    await settings.putGlobal(cheaperRefine(), null, OWNER);
    const narrower = fields();
    narrower.providers["claude-sub"].warnPct = 60;
    await settings.putProject("ai", narrower, null, OWNER);
    expect((await settings.globalChanges(OWNER)).map((c) => c.entityId)).toEqual(["global"]);
    expect(await changes.listForProject("ai")).toHaveLength(1);
  });
});

describe("widerThanGlobal", () => {
  it("GivenAHigherPauseLevelOrLowerReserve_WhenChecked_ThenEachIsNamed", () => {
    const project = fields();
    project.providers["claude-sub"].pausePct = 90;
    project.providers["claude-sub"].reservePct = 10;
    expect(widerThanGlobal(project, fields())).toEqual([
      "provider claude-sub: reserve 10% is below global 20%",
      "provider claude-sub: pause at 90% is above global 80%",
    ]);
  });

  it("GivenTheSameConfig_WhenChecked_ThenNothingIsWider", () => {
    expect(widerThanGlobal(fields(), fields())).toEqual([]);
  });
});
