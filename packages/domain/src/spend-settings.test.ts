import {
  DEFAULT_SPEND_CAPS,
  InMemoryConfigChangeStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigRevert } from "./config-revert";
import { ProjectService } from "./projects";
import { formatMicroUsd, projectCapsRefusal, spendView } from "./spend-settings";

const OWNER = { actor: "user:uid-1" as const, email: "andy@example.com" };
const AGENT = { actor: "agent:run-1" as const, email: "" };

describe("formatMicroUsd", () => {
  it.each([
    [0, "$0.00"],
    [5_000_000, "$5.00"],
    [1_234_567, "$1.23"],
    [9_999, "$0.00"],
  ])("Given%sMicroDollars_WhenFormatted_Then%s", (micro, text) => {
    expect(formatMicroUsd(micro)).toBe(text);
  });
});

describe("projectCapsRefusal", () => {
  it("GivenCapsAtOrBelowGlobalOrUnset_WhenChecked_ThenNoReason", () => {
    expect(
      projectCapsRefusal(DEFAULT_SPEND_CAPS, {
        dailyMicroUsd: DEFAULT_SPEND_CAPS.dailyMicroUsd,
        monthlyMicroUsd: 0,
        perTaskMicroUsd: null,
      }),
    ).toEqual([]);
  });

  it("GivenCapsAboveGlobal_WhenChecked_ThenOneReasonEachNamingBothAmounts", () => {
    expect(
      projectCapsRefusal(DEFAULT_SPEND_CAPS, {
        dailyMicroUsd: 6_000_000,
        perTaskMicroUsd: 3_000_000,
      }),
    ).toEqual([
      "the project's daily cap $6.00 is above the global daily cap $5.00; a project can only lower it",
      "the project's per-task cap $3.00 is above the global per-task cap $2.00; a project can only lower it",
    ]);
  });
});

describe("spendView", () => {
  it("GivenOwnCapsAndSpend_WhenViewed_ThenGlobalIsTheDefaultAndEffectiveTakesTheLower", () => {
    const spent = {
      project: { dayMicroUsd: 1, monthMicroUsd: 2 },
      global: { dayMicroUsd: 3, monthMicroUsd: 4 },
    };
    expect(spendView({ dailyMicroUsd: 1_000_000 }, spent)).toEqual({
      global: { caps: DEFAULT_SPEND_CAPS, source: "default" },
      project: { dailyMicroUsd: 1_000_000 },
      effective: {
        per_task: 2_000_000,
        project_daily: 1_000_000,
        project_monthly: 50_000_000,
        global_daily: 5_000_000,
        global_monthly: 50_000_000,
      },
      spent,
    });
  });

  it("GivenNoLedger_WhenViewed_ThenSpentIsUnknownNotZero", () => {
    expect(spendView(undefined, null).spent).toBeNull();
  });
});

describe("ProjectService spend caps (AI-249)", () => {
  let tracker: InMemoryWorkTracker;
  let changes: InMemoryConfigChangeStore;
  let projects: ProjectService;
  let ids: number;
  const now = () => new Date("2026-11-21T10:00:00.000Z");

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tracker = new InMemoryWorkTracker();
    changes = new InMemoryConfigChangeStore();
    ids = 0;
    projects = new ProjectService(tracker, null, null, now, changes, () => `change-${++ids}`);
    await tracker.createProject({ name: "AI", key: "AI", repos: ["a/b"] });
  });

  it("GivenANewProject_WhenRead_ThenItHasNoOwnCaps", async () => {
    expect((await tracker.getProject("ai"))?.spendCaps).toEqual({});
  });

  it("GivenACapAboveGlobal_WhenTheOwnerSetsIt_ThenRefusedWithTheReasonAndNothingStored", async () => {
    await expect(
      projects.update("ai", { spendCaps: { monthlyMicroUsd: 60_000_000 } }, OWNER),
    ).rejects.toMatchObject({
      code: "invalid_field",
      message: expect.stringContaining("above the global monthly cap $50.00"),
    });
    expect((await tracker.getProject("ai"))?.spendCaps).toEqual({});
    expect(await changes.listForProject("ai")).toEqual([]);
  });

  it("GivenALowerCap_WhenTheOwnerSetsIt_ThenStoredAndLoggedWithOldAndNewValues", async () => {
    const project = await projects.update(
      "ai",
      { spendCaps: { dailyMicroUsd: 1_000_000 } },
      OWNER,
      "trial",
    );
    expect(project.spendCaps).toEqual({ dailyMicroUsd: 1_000_000 });
    const [change] = await changes.listForProject("ai");
    expect(change).toMatchObject({
      reason: "trial",
      diff: { spendCaps: { from: {}, to: { dailyMicroUsd: 1_000_000 } } },
    });
  });

  it("GivenACapChange_WhenReverted_ThenTheOldCapsAreBack", async () => {
    await projects.update("ai", { spendCaps: { dailyMicroUsd: 1_000_000 } }, OWNER);
    const revert = new ConfigRevert(tracker, projects, changes, now);
    const { project } = await revert.revert("ai", "change-1", OWNER, "app");
    expect(project.spendCaps).toEqual({});
  });

  // Intended: a project cap is never stored above global, a revert included (it goes through
  // the same write). The refusal names the cap, so the owner sees why the revert didn't apply.
  it("GivenGlobalCapsLoweredSince_WhenACapChangeIsReverted_ThenRefusedWithTheReason", async () => {
    await tracker.updateProject("ai", { spendCaps: { dailyMicroUsd: 4_000_000 } });
    await projects.update("ai", { spendCaps: { dailyMicroUsd: 1_000_000 } }, OWNER);
    let global = DEFAULT_SPEND_CAPS;
    const lowered = new ProjectService(
      tracker,
      null,
      null,
      now,
      changes,
      () => `change-${++ids}`,
      () => global,
    );
    global = { ...DEFAULT_SPEND_CAPS, dailyMicroUsd: 3_000_000 };
    const revert = new ConfigRevert(tracker, lowered, changes, now);
    await expect(revert.revert("ai", "change-1", OWNER, "app")).rejects.toMatchObject({
      code: "invalid_field",
      message: expect.stringContaining("daily cap $4.00 is above the global daily cap $3.00"),
    });
    expect((await tracker.getProject("ai"))?.spendCaps).toEqual({ dailyMicroUsd: 1_000_000 });
  });

  it("GivenANonOwner_WhenSettingCaps_ThenForbiddenAndNothingStored", async () => {
    await expect(
      projects.update("ai", { spendCaps: { dailyMicroUsd: 0 } }, AGENT),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect((await tracker.getProject("ai"))?.spendCaps).toEqual({});
  });
});
