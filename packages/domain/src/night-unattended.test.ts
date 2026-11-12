import {
  InMemoryCodeHost,
  InMemoryNightLaunchStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  NightLaunch,
  type NewTicket,
  type RefineGap,
  type RefineOutput,
  type Run,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuildDispatcher } from "./build-dispatch";
import { PullRequestGate } from "./gate-service";
import { branchFor } from "./builds";
import { NightUnattended, launchDependants } from "./night-unattended";
import { RefineGate } from "./refine-gate";
import { RunService } from "./runs";
import { WorkflowExecutor, buildOutput } from "./test-executor";
import { TicketService } from "./tickets";

/** AI-123 (ADR-0049 "While unattended"): night assumptions and stories stopped for the night. */

const REPO = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};
const NOW = new Date("2026-11-12T23:00:00.000Z");

const readyFields: Partial<NewTicket> = {
  type: "feature",
  body: "Andy can't see his tickets.",
  acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list his tickets"],
  size: "S",
  sizeReason: "one screen",
};

const gap = (question: string, over: Partial<RefineGap> = {}): RefineGap => ({
  question,
  assumption: `assume ${question}`,
  options: [],
  context: "Context for the question.",
  recommendation: { answer: "yes", reason: "the simplest" },
  cost: "reversible",
  confidence: "sure",
  urgency: "normal",
  ...over,
});

const ready = (gaps: RefineGap[]): RefineOutput => ({
  summary: "s",
  type: "feature",
  size: "S",
  sizeReason: "one screen",
  risk: "low",
  riskReason: "r",
  confidence: "high",
  confidenceReason: "r",
  outOfScope: [],
  touches: [],
  body: null,
  acceptanceCriteria: [],
  outcome: "ready",
  reason: null,
  children: [],
  gaps,
});

async function setup() {
  const tracker = new InMemoryWorkTracker(() => NOW);
  const store = new InMemoryNightLaunchStore();
  const runStore = new InMemoryRunStore(() => NOW);
  const night = new NightUnattended(store, tracker, () => NOW);
  const projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] }))
    .id;
  await tracker.updateProject(projectId, { buildEnabled: true, autoBuild: true });
  const story = async (title: string, blockedBy: string[] = []) => {
    const t = await tracker.createTicket(projectId, { ...readyFields, title, blockedBy }, "andy");
    return tracker.updateTicket(
      projectId,
      t.id,
      { stage: { to: "ready", forced: false, reason: null } },
      "andy",
    );
  };
  const launch = async (storyKeys: string[], over: Partial<NightLaunch> = {}) =>
    store.create(
      NightLaunch.parse({
        id: "launch-1",
        projectId,
        epicId: "epic-1",
        epicKey: "AI-99",
        budget: { maxRuns: 20, maxTokens: 5_000_000, maxUsd: 50 },
        stopAt: new Date(NOW.getTime() + 8 * 3600_000).toISOString(),
        status: "running",
        storyKeys,
        createdAt: NOW.toISOString(),
        createdBy: "user:uid-1",
        startedAt: NOW.toISOString(),
        ...over,
      }),
    );
  return { tracker, store, runStore, night, projectId, story, launch };
}

beforeEach(() => void vi.spyOn(console, "log").mockImplementation(() => {}));

describe("launchDependants", () => {
  it("GivenAStoppedStory_WhenItsDependantsAreFound_ThenDirectAndIndirectOnesInTheLaunchAreSkipped", () => {
    const tickets = [
      { key: "AI-1", blockedBy: [] },
      { key: "AI-2", blockedBy: ["AI-1"] },
      { key: "AI-3", blockedBy: ["AI-2"] },
      { key: "AI-4", blockedBy: [] },
      { key: "AI-5", blockedBy: ["AI-1"] },
    ];
    // AI-5 waits on AI-1 but isn't in the launch.
    expect(launchDependants(["AI-1", "AI-2", "AI-3", "AI-4"], tickets, "AI-1")).toEqual([
      "AI-2",
      "AI-3",
    ]);
    expect(launchDependants(["AI-1", "AI-4"], tickets, "AI-4")).toEqual([]);
  });

  it("GivenAChainThroughATicketOutsideTheLaunch_WhenDependantsAreFound_ThenTheLaunchStoryAtItsEndIsSkipped", () => {
    // AI-1 and AI-3 are launched; AI-2 (not launched) waits on AI-1, and AI-3 waits on AI-2.
    const tickets = [
      { key: "AI-1", blockedBy: [] },
      { key: "AI-2", blockedBy: ["AI-1"] },
      { key: "AI-3", blockedBy: ["AI-2"] },
    ];
    expect(launchDependants(["AI-1", "AI-3"], tickets, "AI-1")).toEqual(["AI-3"]);
  });
});

describe("NightUnattended.coveringLaunch", () => {
  it("GivenLaunches_WhenATicketIsLookedUp_ThenOnlyARunningLaunchListingItCoversIt", async () => {
    const t = await setup();
    await t.launch(["AI-1"]);
    expect((await t.night.coveringLaunch({ projectId: t.projectId, key: "AI-1" }))?.id).toBe(
      "launch-1",
    );
    expect(await t.night.coveringLaunch({ projectId: t.projectId, key: "AI-2" })).toBeNull();
    await t.store.transition("launch-1", ["running"], { status: "stopping" });
    expect(await t.night.coveringLaunch({ projectId: t.projectId, key: "AI-1" })).toBeNull();
  });
});

describe("refine gate while unattended", () => {
  const upNext = async (t: Awaited<ReturnType<typeof setup>>) => {
    const made = await t.tracker.createTicket(
      t.projectId,
      { ...readyFields, title: "Board" },
      "andy",
    );
    return t.tracker.updateTicket(
      t.projectId,
      made.id,
      { fields: { upNextRank: "0000000001" } },
      "system",
    );
  };
  const run = (ticketId: string, projectId: string) =>
    ({ id: "run-1", projectId, ticketId, step: "refine", createdAt: NOW.toISOString() }) as Run;

  it("GivenACoveredTicket_WhenRefineHasGapsToAsk_ThenTheyAreNightAssumptionsWithTheLaunchIdAndItGoesOn", async () => {
    const t = await setup();
    const ticket = await upNext(t);
    await t.launch([ticket.key]);
    const gate = new RefineGate(t.tracker, () => NOW, t.night);

    const applied = await gate.apply(
      run(ticket.id, t.projectId),
      ready([
        gap("Which database?", { cost: "scope" }),
        gap("Tabs?"),
        gap("Unsure?", { confidence: "unsure" }),
      ]),
    );

    expect(await t.tracker.listQuestions({ ticketId: ticket.id })).toEqual([]);
    const after = (await t.tracker.getTicket(t.projectId, ticket.id))!;
    expect(after.refineAssumptions.map((a) => [a.question, a.nightLaunchId, a.demotedBy])).toEqual([
      ["Which database?", "launch-1", null],
      ["Tabs?", null, null],
      ["Unsure?", "launch-1", null],
    ]);
    expect(after).toMatchObject({ stage: "ready", needsAttention: false });
    expect("notice" in applied && applied.notice).toContain("Night launch launch-1 is running");
  });

  it("GivenNoRunningLaunch_WhenRefineHasAGapToAsk_ThenItIsAskedAsBefore", async () => {
    const t = await setup();
    const ticket = await upNext(t);
    await t.launch([ticket.key], {
      status: "ended",
      endedAt: NOW.toISOString(),
      endReason: "done",
    });
    const gate = new RefineGate(t.tracker, () => NOW, t.night);

    await gate.apply(
      run(ticket.id, t.projectId),
      ready([gap("Which database?", { cost: "scope" })]),
    );

    expect(await t.tracker.listQuestions({ ticketId: ticket.id, status: "open" })).toHaveLength(1);
    const after = (await t.tracker.getTicket(t.projectId, ticket.id))!;
    expect(after.refineAssumptions).toEqual([]);
    expect(after).toMatchObject({ stage: "backlog", needsAttention: true });
  });

  it("GivenACoveredTicketWithAHeldGap_WhenHeldGapsAreAsked_ThenNothingIsAsked", async () => {
    const t = await setup();
    const ticket = await upNext(t);
    await t.tracker.updateTicket(
      t.projectId,
      ticket.id,
      {
        fields: {
          refineAssumptions: [
            {
              id: "run-0-a1",
              text: "assume X",
              question: "X?",
              options: [],
              cost: "scope",
              confidence: "unsure",
              demotedBy: "daily_cap",
              nightLaunchId: null,
              runId: "run-0",
              status: "assumed",
              questionId: null,
              answeredAt: null,
              settledBy: null,
              createdAt: NOW.toISOString(),
            } as never,
          ],
        },
      },
      "system",
    );
    await t.launch([ticket.key]);
    const gate = new RefineGate(t.tracker, () => NOW, t.night);
    expect(await gate.askHeld((await t.tracker.getTicket(t.projectId, ticket.id))!)).toBe(0);
    expect(await t.tracker.listQuestions({ ticketId: ticket.id })).toEqual([]);
  });
});

describe("a story that stops for the night", () => {
  async function withRuns() {
    const t = await setup();
    const runs = new RunService(
      t.tracker,
      t.runStore,
      new WorkflowExecutor(new InMemoryCodeHost([REPO])),
      () => NOW,
      null,
      null,
      null,
      null,
      t.night,
    );
    return { ...t, runs };
  }
  const fail = (runs: RunService, run: Run, branch: string) =>
    runs.report(run.id, run.executor!, {
      status: "failed",
      summary: "tests failed",
      output: undefined,
      branch,
      tokensIn: 10,
      tokensOut: 2,
      costUsd: 0.01,
    });

  it("GivenALaunchedStory_WhenItsBuildFailsOnItsRetry_ThenItStopsWithTheReasonItsDependantsAreSkippedAndOthersGoOn", async () => {
    const t = await withRuns();
    const a = await t.story("Schema");
    const b = await t.story("API", [a.key]);
    const c = await t.story("Docs");
    await t.launch([a.key, b.key, c.key]);

    const first = await t.runs.start(t.projectId, a.id, "build");
    await t.runs.context(first.id, first.executor!);
    await fail(t.runs, first, branchFor(a.key, first.id));
    const retry = (await t.runStore.listForTicket(t.projectId, a.id)).find((r) => r.attempt === 2)!;
    await t.runs.context(retry.id, retry.executor!);
    await fail(t.runs, retry, branchFor(a.key, retry.id));

    const launch = (await t.store.get("launch-1"))!;
    expect(launch.stoppedStories).toEqual([
      expect.objectContaining({ key: a.key, skipped: [b.key] }),
    ]);
    expect(launch.stoppedStories[0]!.reason).toContain("on its retry");
    const events = await t.tracker.listEvents(t.projectId, a.id);
    expect(events.some((e) => e.body?.startsWith("Stopped for the night (launch launch-1)"))).toBe(
      true,
    );
    expect((await t.tracker.getTicket(t.projectId, a.id))!.needsAttention).toBe(true);

    // The dependant never starts (its blocker isn't Done); the independent story does.
    const dispatcher = new BuildDispatcher(t.tracker, t.runStore, t.runs, () => NOW);
    const next = await dispatcher.next(t.projectId);
    expect(next?.ticketId).toBe(c.id);
    expect(await t.runStore.listForTicket(t.projectId, b.id)).toEqual([]);
  });

  it("GivenAStoryNoLaunchCovers_WhenItsBuildFailsForGood_ThenNothingIsStopped", async () => {
    const t = await withRuns();
    const a = await t.story("Schema");
    await t.launch(["AI-77"]);

    const first = await t.runs.start(t.projectId, a.id, "build");
    await t.runs.context(first.id, first.executor!);
    await fail(t.runs, first, branchFor(a.key, first.id));
    const retry = (await t.runStore.listForTicket(t.projectId, a.id)).find((r) => r.attempt === 2)!;
    await t.runs.context(retry.id, retry.executor!);
    await fail(t.runs, retry, branchFor(a.key, retry.id));

    expect((await t.store.get("launch-1"))!.stoppedStories).toEqual([]);
  });
});

describe("a launched story whose PR is vetoed", () => {
  it("GivenALaunchedStorysPr_WhenTheMergeGateVetoesIt_ThenTheStoryStopsForTheNightWithTheReasons", async () => {
    const t = await setup();
    const a = await t.story("Schema");
    const b = await t.story("API", [a.key]);
    await t.launch([a.key, b.key]);
    const host = new InMemoryCodeHost([REPO]);
    const runs = new RunService(t.tracker, t.runStore, new WorkflowExecutor(host), () => NOW);
    const run = await runs.start(t.projectId, a.id, "build");
    await runs.context(run.id, run.executor!);
    const realBranch = branchFor(a.key, run.id);
    const url = `https://github.com/${REPO.fullName}/pull/50`;
    await runs.report(run.id, run.executor!, {
      status: "succeeded",
      summary: "done",
      output: buildOutput,
      tokensIn: 10,
      tokensOut: 2,
      costUsd: 0.01,
      branch: realBranch,
      pullRequest: url,
    });
    host.pullRequests.set(50, {
      pullRequest: {
        number: 50,
        state: "open",
        draft: false,
        title: `${a.key}: Schema`,
        bodyFirstLine: "",
        fromFork: false,
        intoDefaultBranch: true,
        headRef: realBranch,
        headSha: "head1",
        baseRef: "main",
        url,
      },
      files: { items: [{ path: ".github/workflows/x.yml", previousPath: null }], complete: true },
      checks: { items: [], complete: true },
      commits: { items: [], complete: true },
    });
    const project = (await t.tracker.getProject(t.projectId))!;
    const gate = new PullRequestGate(
      host,
      t.tracker,
      t.runStore,
      new TicketService(t.tracker),
      () => NOW,
      t.night,
    );

    await gate.apply(
      {
        kind: "pull_request",
        deliveryId: "d-1",
        projectId: t.projectId,
        repo: REPO.fullName,
        action: "opened",
        receivedAt: NOW.toISOString(),
        pullRequest: host.pullRequests.get(50)!.pullRequest,
      },
      project,
    );

    const launch = (await t.store.get("launch-1"))!;
    expect(launch.stoppedStories).toEqual([
      expect.objectContaining({ key: a.key, skipped: [b.key] }),
    ]);
    expect(launch.stoppedStories[0]!.reason).toContain("vetoed its PR #50");
    expect(launch.stoppedStories[0]!.reason).toContain("protected_path");
    expect((await t.tracker.getTicket(t.projectId, a.id))!.needsAttention).toBe(true);
  });
});
