import { InMemoryWorkTracker, type AutoMerge, type MergeMode, type Project } from "@andy/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import {
  MERGE_MODE_ORDER,
  MERGE_MODE_TEXT,
  effectiveMergeMode,
  effectiveTicketMergeMode,
  isLooser,
  requireOverrideNotLooser,
  requireTightening,
} from "./merge-mode";
import { ProjectService } from "./projects";
import { TicketService } from "./tickets";

const project = (over: Partial<Project> = {}) =>
  ({ id: "ops", key: "OPS", mergeMode: null, autoMerge: "none", ...over }) as Project;

describe("effectiveMergeMode", () => {
  it.each<[AutoMerge, MergeMode]>([
    ["none", "manual"],
    ["s", "low-risk"],
    ["s-and-m", "low-risk"],
    ["all", "all-clean"],
  ])("GivenNoModeAndAutoMerge %s_WhenRead_ThenItIs %s", (autoMerge, mode) => {
    expect(effectiveMergeMode(project({ autoMerge }))).toBe(mode);
  });

  it("GivenProjectAiWithNoMode_WhenRead_ThenItIsAllClean", () => {
    expect(effectiveMergeMode(project({ id: "ai", key: "AI", autoMerge: "none" }))).toBe(
      "all-clean",
    );
  });

  it("GivenAStoredMode_WhenRead_ThenItWinsOverAutoMerge", () => {
    expect(effectiveMergeMode(project({ mergeMode: "epic", autoMerge: "all" }))).toBe("epic");
  });

  it("GivenEveryMode_WhenListed_ThenEachHasItsLineAndManualIsStrictest", () => {
    expect(MERGE_MODE_ORDER[0]).toBe("manual");
    for (const m of MERGE_MODE_ORDER) expect(MERGE_MODE_TEXT[m].length).toBeGreaterThan(10);
    expect(isLooser("all-clean", "low-risk")).toBe(true);
    expect(isLooser("epic", "low-risk")).toBe(false);
    expect(isLooser("manual", "manual")).toBe(false);
  });
});

describe("effectiveTicketMergeMode", () => {
  it("GivenAStricterOverride_WhenRead_ThenTheOverrideApplies", () => {
    expect(effectiveTicketMergeMode(project({ mergeMode: "all-clean" }), "low-risk")).toBe(
      "low-risk",
    );
  });

  it("GivenAProjectTightenedAfterALooserOverride_WhenRead_ThenTheProjectWins", () => {
    // Allowed when written (equal), then the project went to manual: the override no longer counts.
    expect(effectiveTicketMergeMode(project({ mergeMode: "manual" }), "all-clean")).toBe("manual");
  });

  it("GivenNoOverride_WhenRead_ThenItIsTheProjectsMode", () => {
    expect(effectiveTicketMergeMode(project({ mergeMode: "epic" }), undefined)).toBe("epic");
  });
});

describe("requireOverrideNotLooser and requireTightening", () => {
  it("GivenALowRiskProject_WhenAnOverrideIsStricterOrEqual_ThenItIsAllowed", () => {
    for (const m of ["manual", "epic", "low-risk"] as const)
      expect(() => requireOverrideNotLooser(m, project({ mergeMode: "low-risk" }))).not.toThrow();
  });

  it("GivenALowRiskProject_WhenAnOverrideIsLooser_ThenItIsRefused", () => {
    expect(() => requireOverrideNotLooser("all-clean", project({ mergeMode: "low-risk" }))).toThrow(
      DomainError,
    );
  });

  it("GivenManual_WhenLoosening_ThenRefusedAndTighteningAllowed", () => {
    expect(() => requireTightening("low-risk", project({ mergeMode: "manual" }))).toThrow(/looser/);
    expect(() => requireTightening("manual", project({ mergeMode: "all-clean" }))).not.toThrow();
  });
});

describe("merge mode in the services", () => {
  let tracker: InMemoryWorkTracker;

  beforeEach(async () => {
    tracker = new InMemoryWorkTracker();
    await tracker.createProject({ name: "Ops", key: "OPS" });
  });

  it("GivenANewProject_WhenCreated_ThenItStartsLowRisk", async () => {
    expect((await tracker.getProject("ops"))?.mergeMode).toBe("low-risk");
  });

  it("GivenALowRiskProject_WhenATicketOverrideIsLooser_ThenCreateAndEditAreRefused", async () => {
    const tickets = new TicketService(tracker);
    await expect(
      tickets.create("ops", { title: "Loose", overrides: { mergeMode: "all-clean" } }, "user:andy"),
    ).rejects.toThrow(/looser/);
    const ok = await tickets.create(
      "ops",
      { title: "Strict", overrides: { mergeMode: "manual" } },
      "user:andy",
    );
    expect(ok.overrides.mergeMode).toBe("manual");
    await expect(
      tickets.update("ops", ok.id, { overrides: { mergeMode: "all-clean" } }, "user:andy"),
    ).rejects.toThrow(/looser/);
  });

  it("GivenLowRisk_WhenTightenedThenLoosenedOverTheMcpPath_ThenOnlyTheTighteningSaves", async () => {
    const projects = new ProjectService(tracker, null);
    const by = { actor: "user:andy" as const, email: "andy@example.com" };
    expect((await projects.tightenMergeMode("ops", "epic", by)).mergeMode).toBe("epic");
    await expect(projects.tightenMergeMode("ops", "all-clean", by)).rejects.toMatchObject({
      message: expect.stringContaining("looser"),
      details: [expect.stringContaining("project settings page")],
    });
    expect((await tracker.getProject("ops"))?.mergeMode).toBe("epic");
  });
});
