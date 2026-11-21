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
  const store = new InMemoryRoutingConfigStore(() => T0);
  let n = 0;
  const settings = new RoutingSettings(
    store,
    tracker,
    changes,
    () => T0,
    () => `change-${++n}`,
  );
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
