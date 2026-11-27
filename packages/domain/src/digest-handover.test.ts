import {
  InMemoryCodeHost,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type NewTicket,
  type Ticket,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuildDispatcher } from "./build-dispatch";
import { buildDigest, digestWindow, DigestReader, type DigestData } from "./digest";
import { MAX_ACTIVE_RUNS_GLOBAL } from "./dispatch-caps";
import { DispatchFactsReader } from "./next-up";
import { RunService } from "./runs";
import { WorkflowExecutor } from "./test-executor";

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

describe("DigestReader handover", () => {
  let tracker: InMemoryWorkTracker;
  let runStore: InMemoryRunStore;
  let host: InMemoryCodeHost;
  let projectId: string;
  let ms: number;
  const now = () => new Date((ms += 1000));

  function wire() {
    const runs: RunService = new RunService(
      tracker,
      runStore,
      new WorkflowExecutor(host),
      now,
      null,
      async () => {},
      host,
    );
    const dispatcher = new BuildDispatcher(tracker, runStore, runs, now);
    const facts = new DispatchFactsReader(runs, runStore, null, now);
    const reader = new DigestReader(tracker, runStore, null, now, undefined, null, facts);
    return { dispatcher, reader };
  }

  const inReady = async (title: string, extra: Partial<NewTicket> = {}) => {
    const t = await tracker.createTicket(projectId, ready(title, extra), "andy");
    return tracker.updateTicket(
      projectId,
      t.id,
      { stage: { to: "ready", forced: false, reason: null } },
      "andy",
    );
  };

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    ms = Date.parse("2026-11-27T12:00:00.000Z");
    tracker = new InMemoryWorkTracker(now);
    runStore = new InMemoryRunStore(now);
    host = new InMemoryCodeHost([REPO]);
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
    await tracker.updateProject(projectId, { autoBuild: true, buildEnabled: true, runsAtOnce: 2 });
  });

  it("GivenReadyTickets_WhenTheDigestIsRead_ThenTheDryRunStartsReservesAndWritesNothing", async () => {
    const { reader } = wire();
    await inReady("One");
    await inReady("Two");
    const project = await tracker.getProject(projectId);
    const tickets = await tracker.listTickets(projectId);

    const d = await reader.digest(projectId, digestWindow(now()));

    expect(d.handover!.nextUp.map((i) => i.status)).toEqual(["starts_now", "starts_now"]);
    expect(await runStore.listActive(projectId)).toEqual([]);
    expect(await tracker.getProject(projectId)).toEqual(project);
    expect(await tracker.listTickets(projectId)).toEqual(tickets);
  });

  it("GivenTheSameTickets_WhenTheDispatcherRunsAfterTheDryRun_ThenItStartsWhatTheDryRunSaid", async () => {
    const { reader, dispatcher } = wire();
    await tracker.updateProject(projectId, { runsAtOnce: 1 });
    const blocker = await tracker.createTicket(projectId, ready("Blocker"), "andy");
    await inReady("Blocked", { blockedBy: [blocker.key] });
    const free = await inReady("Free");
    await inReady("Later");

    const d = await reader.digest(projectId, digestWindow(now()));
    const started = d.handover!.nextUp.filter((i) => i.status === "starts_now");
    const run = await dispatcher.next(projectId);

    expect(started.map((i) => i.ticketKey)).toEqual([free.key]);
    expect(run?.ticketId).toBe(free.id);
    expect(d.handover!.nextUp.map((i) => i.status)).toEqual(["skipped", "starts_now", "next"]);
  });

  it("GivenOtherProjectsFillTheGlobalCap_WhenRead_ThenNextUpSaysTheGlobalCap", async () => {
    const { reader } = wire();
    await inReady("One");
    const other = await tracker.createProject({ name: "Ops", key: "OPS", repos: [] });
    for (let i = 0; i < MAX_ACTIVE_RUNS_GLOBAL; i += 1) {
      await runStore.create({
        projectId: other.id,
        ticketId: `o${i}`,
        step: "refine",
        route: { harness: "claude-code", provider: "claude-sub", model: "sonnet" },
        tier: null,
      });
    }
    const d = await reader.digest(projectId, digestWindow(now()));
    expect(d.handover!.nextUp.map((i) => i.status)).toEqual(["next"]);
    expect(d.handover!.idle).toBe("Dispatch is at the global cap (4 agent tasks at once)");
  });

  it("GivenAReadyTicketUntouchedForDays_WhenRead_ThenItsItemSaysTheBuildRunCapWasntChecked", async () => {
    const { reader } = wire();
    await tracker.updateProject(projectId, { autoBuild: false });
    const old = await inReady("Old");
    ms += 3 * 86_400_000;
    const fresh = await inReady("Fresh");

    const d = await reader.digest(projectId, digestWindow(now()));

    const byKey = new Map(d.handover!.nextUp.map((i) => [i.ticketKey, i.reason]));
    expect(byKey.get(old.key)).toBe("Build-run cap not checked: its agent tasks weren't read");
    expect(byKey.get(fresh.key)).toBeNull();
  });

  it("GivenAPastWindow_WhenRead_ThenNoHandover", async () => {
    const { reader } = wire();
    await inReady("One");
    const d = await reader.digest(projectId, digestWindow(now(), 24, "2026-11-20T00:00:00.000Z"));
    expect(d.handover).toBeNull();
  });

  it("GivenNoDispatchFactsReader_WhenRead_ThenNoHandover", async () => {
    const d = await new DigestReader(tracker, runStore, null).digest(
      projectId,
      digestWindow(now()),
    );
    expect(d.handover).toBeNull();
  });

  it("GivenTheDispatchFactsReadFails_WhenRead_ThenTheDigestShowsWithoutAHandover", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = { facts: () => Promise.reject(new Error("down")) };
    const reader = new DigestReader(tracker, runStore, null, now, undefined, null, failing);
    const d = await reader.digest(projectId, digestWindow(now()));
    expect(d.handover).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("buildDigest handover text", () => {
  const NOW = new Date("2026-11-27T12:00:00.000Z");
  const t = {
    id: "t1",
    projectId: "ai",
    key: "AI-1",
    title: "Board",
    type: "feature",
    body: "x",
    acceptanceCriteria: ["The system shall x."],
    size: "S",
    sizeReason: "small",
    stage: "ready",
    rank: "0000000001",
    archived: false,
    needsAttention: false,
    blockedBy: [],
    touches: [],
    overrides: {},
    parentId: null,
    updatedAt: "2026-11-01T00:00:00.000Z",
  } as unknown as Ticket;
  const data: DigestData = {
    project: {
      key: "AI",
      paused: false,
      runsAtOnce: 2,
      lastDispatch: null,
      defaultWorker: "agent",
    },
    tickets: [t],
    openQuestions: new Map(),
    activeRuns: [],
    endedRuns: [],
    ticketRuns: new Map(),
    ticketEvents: new Map(),
    quota: [],
    quotaClears: [],
    truncated: false,
    now: NOW,
    handover: {
      project: {
        id: "ai",
        key: "AI",
        autoBuild: false,
        buildEnabled: true,
        paused: false,
        runsAtOnce: 2,
        defaultWorker: "agent",
        executor: "actions",
        planApproval: "none",
      },
      milestoneHolds: new Map(),
      facts: { canDispatch: true, runnerPresent: false, globalActive: 0, quotaLevel: "ok" },
    },
  };

  it("GivenAQuietDayWithAReadyTicket_WhenBuilt_ThenTheTextStillCarriesNextUpAndWhyNothingStarts", () => {
    const d = buildDigest(digestWindow(NOW), data);
    expect(d.quiet).toBe(true);
    expect(d.text).toBe(
      [
        "AI digest · last 24 hours: nothing happened.",
        "",
        "Next up (1)",
        // Untouched in the window, so its agent tasks weren't read (no reads per ticket).
        "- Next: AI-1: Board · Build-run cap not checked: its agent tasks weren't read",
        "- Nothing starts on its own: auto-build is off, so Andy starts each build",
      ].join("\n"),
    );
  });
});
