import {
  InMemoryEpicBreakdownStore,
  InMemoryMilestoneStore,
  InMemoryOAuthGrantStore,
  type EpicBreakdownProposal,
} from "@andy/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPO, createdApp, githubApp } from "./github/test-app";
import { ClientMetadataResolver } from "./mcp/client-metadata";
import { mcpCaller } from "./mcp/test-client";

/**
 * AI-383: epic breakdowns over REST and MCP, in-process (ADR-0148 parity): the same service, the
 * same refusals. GitHub is faked, as in project-task-tools.test.ts.
 */

const PUBLIC_URL = "http://localhost";

const proposal: EpicBreakdownProposal = {
  summary: "Form first, then the list.",
  tickets: [
    {
      title: "Log a run",
      type: "feature",
      size: "S",
      sizeReason: "One form.",
      body: "A form that saves a run.",
      acceptanceCriteria: ["When Andy saves a run, the system shall list it."],
      touches: ["apps/web/**"],
      blockedBy: [],
    },
    {
      title: "List runs",
      type: "feature",
      size: "S",
      sizeReason: "One list.",
      body: "The list.",
      acceptanceCriteria: ["When Andy opens runs, the system shall list them newest first."],
      touches: [],
      blockedBy: [0],
    },
  ],
};

async function setup({ approved = true } = {}) {
  const grants = new InMemoryOAuthGrantStore();
  const milestones = new InMemoryMilestoneStore();
  const t = githubApp(
    {},
    {
      mcp: { publicUrl: PUBLIC_URL, grants, clients: new ClientMetadataResolver() },
      milestones,
      epicBreakdowns: new InMemoryEpicBreakdownStore(),
    },
  );
  await t.connections.save({ ...createdApp, connectedAt: "2026-11-03T00:00:00Z" });
  const project = await t.tracker.createProject({ name: "Trail log", key: "TRL", repos: [REPO] });
  await t.tracker.updateProject(project.id, { runsAtOnce: 4 });
  const epic = await t.tracker.createTicket(
    project.id,
    { type: "epic", title: "M1: Log runs", outcome: "Andy logs a run." },
    "andy",
  );
  await milestones.create({
    id: "m1",
    projectId: project.id,
    name: "M1: Log runs",
    outcome: "Andy logs a run.",
    order: 0,
    status: approved ? "approved" : "not_reviewed",
    createdAt: "2026-11-25T00:00:00.000Z",
    updatedAt: "2026-11-25T00:00:00.000Z",
  });
  await t.tracker.updateTicket(project.id, epic.id, { fields: { milestoneId: "m1" } }, "andy");
  const mcp = await mcpCaller(t.app, grants, `${PUBLIC_URL}/mcp`);
  const base = `/api/projects/${project.id}/tickets/${epic.id}/breakdown`;
  const rest = async (path: string, body?: unknown) => {
    const res = await t.call(
      `${base}${path}`,
      body === undefined ? {} : { method: "POST", body: JSON.stringify(body) },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read the JSON freely
    return { status: res.status, json: (await res.json()) as any };
  };
  const children = async () =>
    (await t.tracker.listTickets(project.id)).filter((x) => x.parentId === epic.id);
  return { t, mcp, rest, project, epic, children };
}

describe("epic breakdowns over MCP and REST (AI-383)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("GivenAnEpicInAnApprovedMilestone_WhenAndyStartsOverMcp_ThenARunOnTheEpicAndASecondIsRefusedOnBothSides", async () => {
    const { t, mcp, rest, project, epic } = await setup();

    const started = await mcp("start_epic_breakdown", { ticket: epic.key });
    expect(started.isError).toBe(false);
    const [run] = await t.runs.listActive(project.id);
    expect(run).toMatchObject({ ticketId: epic.id, step: "plan-epic", status: "queued" });
    expect(t.host.workflowRuns.size).toBe(1);

    const second = await rest("/agent-task", {});
    expect(second.status).toBe(409);
    const viaMcp = await mcp("start_epic_breakdown", { ticket: epic.key });
    expect(viaMcp.isError).toBe(true);
    expect(viaMcp.text).toContain(second.json.error);
  });

  it("GivenAMilestoneNotApproved_WhenStarted_ThenRefusedWithTheReasonOnBothSides", async () => {
    const { mcp, rest, epic } = await setup({ approved: false });

    const viaRest = await rest("/agent-task", {});
    expect(viaRest.status).toBe(409);
    expect(viaRest.json.error).toContain("is not approved");
    const viaMcp = await mcp("start_epic_breakdown", { ticket: epic.key });
    expect(viaMcp.isError).toBe(true);
    expect(viaMcp.text).toContain("is not approved");
  });

  it("GivenASubmittedBreakdown_WhenListedAndApprovedOverMcp_ThenItShowsInNeedsYouAndTheTicketsLandInIdeas", async () => {
    const { t, mcp, rest, epic, children } = await setup();

    const submitted = await rest("", proposal);
    expect(submitted.status).toBe(201);
    expect(submitted.json).toMatchObject({ status: "proposed" });

    const inbox = await mcp("list_needs_me");
    expect(inbox.data.epicBreakdowns).toEqual([
      expect.objectContaining({ epicKey: epic.key, epicTitle: "M1: Log runs" }),
    ]);
    const overview = await mcp("status");
    expect(overview.data.needsYou.epicBreakdowns).toBe(1);
    const waiting = await t.call("/api/epic-breakdowns/waiting");
    expect(waiting.status).toBe(200);
    expect(await waiting.json()).toEqual(inbox.data.epicBreakdowns);

    const approved = await mcp("approve_epic_breakdown", { ticket: epic.key });
    expect(approved.isError).toBe(false);
    const made = await children();
    expect(made.map((c) => [c.title, c.stage, c.upNextRank])).toEqual([
      ["Log a run", "backlog", null],
      ["List runs", "backlog", null],
    ]);
    expect(made[1]!.blockedBy).toEqual([made[0]!.key]);
    expect((await rest("")).json.breakdown).toMatchObject({ status: "approved" });
    expect((await mcp("list_needs_me")).data.epicBreakdowns).toEqual([]);
  });

  it("GivenASubmittedBreakdown_WhenSentBackOverRest_ThenNothingIsCreatedAndMcpCantDecideItAgain", async () => {
    const { mcp, rest, epic, children } = await setup();
    await mcp("submit_epic_breakdown", { ticket: epic.key, breakdown: proposal });

    const sent = await rest("/decision", { decision: "rejected", reason: "Split the form." });
    expect(sent.status).toBe(200);
    expect(sent.json.breakdown).toMatchObject({ status: "rejected", reason: "Split the form." });
    expect(await children()).toEqual([]);

    const again = await mcp("reject_epic_breakdown", { ticket: epic.key, reason: "x" });
    expect(again.isError).toBe(true);
    expect(again.text).toContain("no breakdown to decide");
  });
});
