import {
  InMemoryCodeHost,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type NewTicket,
  type TicketOverrides,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuildDispatcher } from "./build-dispatch";
import { RunService } from "./runs";
import { WorkflowExecutor } from "./test-executor";

/** AI-116: the dispatcher and a build start honour an epic's overrides; a child's own wins. */

const REPO = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};

const ready = (title: string, extra: Partial<NewTicket> = {}): NewTicket => ({
  type: "feature",
  title,
  body: "Andy can't see his tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list his tickets"],
  size: "S",
  sizeReason: "one screen",
  touches: [`areas/${title}/**`],
  ...extra,
});

describe("epic overrides at dispatch (AI-116)", () => {
  let tracker: InMemoryWorkTracker;
  let runStore: InMemoryRunStore;
  let dispatcher: BuildDispatcher;
  let projectId: string;
  let ms: number;
  const now = () => new Date((ms += 1000));

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    ms = Date.parse("2026-11-05T12:00:00.000Z");
    tracker = new InMemoryWorkTracker(now);
    runStore = new InMemoryRunStore(now);
    const host = new InMemoryCodeHost([REPO]);
    const runs = new RunService(
      tracker,
      runStore,
      new WorkflowExecutor(host),
      now,
      null,
      null,
      host,
    );
    dispatcher = new BuildDispatcher(tracker, runStore, runs, now);
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
    await tracker.updateProject(projectId, {
      autoRefine: false,
      autoBuild: true,
      buildEnabled: true,
    });
  });

  const epicWith = (overrides: TicketOverrides, extra: Partial<NewTicket> = {}) =>
    tracker.createTicket(projectId, { title: "Epic", type: "epic", overrides, ...extra }, "andy");
  const childInReady = async (title: string, parentId: string, overrides: TicketOverrides = {}) => {
    const t = await tracker.createTicket(projectId, ready(title, { parentId, overrides }), "andy");
    return tracker.updateTicket(
      projectId,
      t.id,
      { stage: { to: "ready", forced: false, reason: null } },
      "andy",
    );
  };

  it("GivenAnEpicAssignedToAndy_WhenNext_ThenItsChildWithoutAnAssigneeIsNotBuilt", async () => {
    const epic = await epicWith({ assignee: "me" });
    const held = await childInReady("Held", epic.id);
    const other = await childInReady("Other", (await epicWith({})).id);
    await tracker.updateTicket(projectId, held.id, { fields: { rank: "0" } }, "andy");

    const run = await dispatcher.next(projectId);

    expect(run?.ticketId).toBe(other.id);
    expect(await runStore.listForTicket(projectId, held.id)).toEqual([]);
  });

  it("GivenAnEpicAssignedToAndy_WhenItsChildIsGivenToTheAgent_ThenTheChildBuilds", async () => {
    const epic = await epicWith({ assignee: "me" });
    const child = await childInReady("Mine to give", epic.id, { assignee: "agent" });

    expect((await dispatcher.next(projectId))?.ticketId).toBe(child.id);
  });

  it("GivenAnEpicTier_WhenItsChildBuilds_ThenTheBuildUsesTheEpicsTier", async () => {
    const epic = await epicWith({ tier: "strong" });
    await childInReady("Small", epic.id);

    const run = await dispatcher.next(projectId);

    expect(run).toMatchObject({ tier: "strong", route: { model: "opus" } });
  });

  it("GivenAnEpicTierAndAChildTier_WhenTheChildBuilds_ThenTheChildsTierWins", async () => {
    const epic = await epicWith({ tier: "strong" });
    await childInReady("Pinned", epic.id, { tier: "fast" });

    expect(await dispatcher.next(projectId)).toMatchObject({ tier: "fast" });
  });

  it("GivenAnArchivedEpicAssignedToAndy_WhenNext_ThenItsChildBuilds", async () => {
    const epic = await epicWith({ assignee: "me" });
    await tracker.updateTicket(
      projectId,
      epic.id,
      { stage: { to: "done", forced: true, reason: null }, fields: { archived: true } },
      "andy",
    );
    const child = await childInReady("Freed", epic.id);

    expect((await dispatcher.next(projectId))?.ticketId).toBe(child.id);
  });
});
