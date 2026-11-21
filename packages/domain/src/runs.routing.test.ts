import {
  DEFAULT_ROUTING,
  InMemoryCodeHost,
  InMemoryRoutingConfigStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
  type RoutingConfigInput,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunService } from "./runs";
import { WorkflowExecutor } from "./test-executor";

/** AI-238: M9.6: RunService reads the stored routing once per start. */

const REPO = {
  fullName: "albernhagen/andy-intelligence",
  defaultBranch: "main",
  private: false,
  url: "https://github.com/albernhagen/andy-intelligence",
};
const NOW = new Date("2026-11-21T12:00:00.000Z");

describe("RunService routing", () => {
  let tracker: InMemoryWorkTracker;
  let routing: InMemoryRoutingConfigStore;
  let service: RunService;
  let projectId: string;

  const projectConfig = (change: (c: RoutingConfigInput) => void): RoutingConfigInput => {
    const { providers, tiers, steps } = structuredClone(DEFAULT_ROUTING);
    const c: RoutingConfigInput = { scope: "project", projectId, providers, tiers, steps };
    change(c);
    return c;
  };
  const readyTicket = async (size: "S" | "M" = "M") => {
    const t = await tracker.createTicket(
      projectId,
      {
        type: "feature",
        title: "Board",
        body: "Andy can't see his tickets.",
        acceptanceCriteria: ["WHEN Andy opens the board THE SYSTEM SHALL list his tickets"],
        size,
        sizeReason: "one screen",
      },
      "andy",
    );
    return tracker.updateTicket(
      projectId,
      t.id,
      { stage: { to: "ready", forced: false, reason: null } },
      "andy",
    );
  };
  const comments = async (ticketId: string) =>
    (await tracker.listEvents(projectId, ticketId))
      .filter((e) => e.kind === "comment")
      .map((e) => e.body);

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tracker = new InMemoryWorkTracker(() => NOW);
    routing = new InMemoryRoutingConfigStore(() => NOW);
    service = new RunService(
      tracker,
      new InMemoryRunStore(() => NOW),
      new WorkflowExecutor(new InMemoryCodeHost([REPO])),
      () => NOW,
      null,
      null,
      null,
      null,
      null,
      null,
      routing,
    );
    projectId = (await tracker.createProject({ name: "AI", key: "AI", repos: [REPO.fullName] })).id;
    await tracker.updateProject(projectId, { buildEnabled: true });
  });

  it("GivenNoStoredConfig_WhenABuildStarts_ThenTodaysRoute", async () => {
    const t = await readyTicket("M");
    const run = await service.start(projectId, t.id, "build");
    expect(run).toMatchObject({
      tier: "strong",
      route: { harness: "claude-code", provider: "claude-sub", model: "opus" },
    });
  });

  it("GivenAProjectWhoseStrongTierPrefersSonnet_WhenABuildStarts_ThenSonnet", async () => {
    await routing.put(
      {
        ...projectConfig(() => {}),
        scope: "global",
        projectId: null,
        tiers: {
          ...DEFAULT_ROUTING.tiers,
          strong: [DEFAULT_ROUTING.tiers.strong[0]!, DEFAULT_ROUTING.tiers.fast[0]!],
        },
      },
      null,
    );
    await routing.put(
      projectConfig((c) => (c.tiers.strong = [DEFAULT_ROUTING.tiers.fast[0]!])),
      null,
    );
    const t = await readyTicket("M");
    expect((await service.start(projectId, t.id, "build")).route.model).toBe("sonnet");
  });

  it("GivenAPinOutsideTheRouting_WhenABuildStarts_ThenTheStartCommentSaysWhyItWasSkipped", async () => {
    const t = await readyTicket("M");
    await tracker.updateTicket(
      projectId,
      t.id,
      {
        fields: {
          overrides: {
            modelPin: { harness: "jules", provider: "google-sub", model: "gemini-pro" },
          },
        },
      },
      "andy",
    );
    const run = await service.start(projectId, t.id, "build");
    expect(run.route.model).toBe("opus");
    expect((await comments(t.id)).join("\n")).toContain(
      "jules/google-sub/gemini-pro skipped: the ticket's model pin: not a route in this project's routing",
    );
  });

  it("GivenNoUsableRoute_WhenABuildStarts_ThenRefusedTheTicketFlaggedAndToldWhyOnce", async () => {
    await routing.put(
      projectConfig((c) => (c.providers["claude-sub"].enabled = false)),
      null,
    );
    const t = await readyTicket("M");
    await expect(service.start(projectId, t.id, "build")).rejects.toMatchObject({
      code: "not_buildable",
      message: expect.stringContaining("no usable route for the strong tier"),
    });
    expect((await tracker.getTicket(projectId, t.id))?.needsAttention).toBe(true);
    await expect(service.start(projectId, t.id, "build")).rejects.toMatchObject({
      code: "not_buildable",
    });
    const told = (await comments(t.id)).filter((c) => c?.startsWith("Couldn't start a build task"));
    expect(told).toEqual([
      "Couldn't start a build task: no usable route for the strong tier: claude-code/claude-sub/opus skipped: provider claude-sub is off. Fix the routing (Settings) or the ticket's model pin, then start it again from the ticket: dispatch skips it while it needs you.",
    ]);
  });

  const claudeOff = () => projectConfig((c) => (c.providers["claude-sub"].enabled = false));

  it("GivenNoUsableRoute_WhenARefineStarts_ThenNotRefinableAndToldOnTheTicket", async () => {
    await routing.put(claudeOff(), null);
    const t = await tracker.createTicket(projectId, { title: "Board" }, "andy");
    await tracker.updateTicket(projectId, t.id, { fields: { upNextRank: "0000000001" } }, "andy");
    await expect(service.start(projectId, t.id, "refine")).rejects.toMatchObject({
      code: "not_refinable",
      message: expect.stringContaining("no usable route for the fast tier"),
    });
    expect((await comments(t.id)).some((c) => c?.startsWith("Couldn't start a refine task"))).toBe(
      true,
    );
  });

  it("GivenNoUsableRoute_WhenASyncStarts_ThenRefusedAndTheTicketFlagged", async () => {
    await routing.put(claudeOff(), null);
    const t = await readyTicket("M");
    await expect(
      service.startSync(projectId, t.id, {
        buildRunId: "run-1",
        pullRequest: `${REPO.url}/pull/7`,
        number: 7,
        branch: "agent/AI-1/run-1",
        headSha: "a".repeat(40),
      }),
    ).rejects.toMatchObject({
      code: "not_buildable",
      message: expect.stringContaining("no usable route"),
    });
    expect((await tracker.getTicket(projectId, t.id))?.needsAttention).toBe(true);
  });

  it("GivenAnAlreadyFlaggedTicket_WhenNoRouteIsUsable_ThenRefusedWithoutAnotherComment", async () => {
    await routing.put(claudeOff(), null);
    const t = await readyTicket("M");
    await tracker.updateTicket(projectId, t.id, { fields: { needsAttention: true } }, "andy");
    await expect(service.start(projectId, t.id, "build")).rejects.toMatchObject({
      code: "not_buildable",
    });
    expect(await comments(t.id)).toEqual([]);
  });

  it("GivenARefusedTicket_WhenTheRoutingIsFixedAndItIsStartedByHand_ThenItRunsAndIsUnflagged", async () => {
    const off = await routing.put(claudeOff(), null);
    const t = await readyTicket("M");
    await expect(service.start(projectId, t.id, "build")).rejects.toMatchObject({
      code: "not_buildable",
    });
    await routing.put(
      projectConfig(() => {}),
      off.updatedAt,
    );
    const run = await service.start(projectId, t.id, "build");
    expect(run.route.model).toBe("opus");
    expect((await tracker.getTicket(projectId, t.id))?.needsAttention).toBe(false);
  });

  it("GivenAFailedBuildAndRoutingTurnedOffSince_WhenItsRetryStarts_ThenOneFlagWithTheRetryReason", async () => {
    const t = await readyTicket("M");
    const run = await service.start(projectId, t.id, "build");
    await service.context(run.id, run.executor!);
    await routing.put(claudeOff(), null);
    await service.report(run.id, run.executor!, {
      status: "failed",
      summary: "tests failed",
      tokensIn: 1,
      tokensOut: 1,
      costUsd: 0,
    });
    expect((await tracker.getTicket(projectId, t.id))?.needsAttention).toBe(true);
    const notes = await comments(t.id);
    expect(
      notes.filter((c) => c?.includes("the retry couldn't start") && c.includes("no usable route")),
    ).toHaveLength(1);
    expect(notes.some((c) => c?.startsWith("Couldn't start a build task"))).toBe(false);
  });
});
