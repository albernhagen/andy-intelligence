import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { EpicBreakdownProposal, MilestoneStatus } from "@andy/contracts";
import { DEFAULT_ROUTE } from "@andy/domain";
import { draftBlocker } from "@/components/EpicBreakdown";
import { PAGE_LOAD, renderApp } from "@/test/harness";

/**
 * AI-383: the epic panel's breakdown (Draft tickets, the waiting draft with Approve and Send
 * back) and the inbox's "Epic breakdowns" section, against the in-process API.
 */

const AT = "2026-11-26T00:00:00.000Z";

const proposal: EpicBreakdownProposal = {
  summary: "Restore first, then alert.",
  tickets: [
    {
      title: "Restore drill **now**",
      type: "chore",
      size: "S",
      sizeReason: "One script.",
      body: "Restore last night's backup into a scratch project.",
      acceptanceCriteria: ["A restore finishes", "Its time is logged"],
      touches: ["infra/backup"],
      blockedBy: [],
    },
    {
      title: "Alert on a failed backup",
      type: "feature",
      size: "M",
      sizeReason: "New alert rule.",
      body: "Page when a backup fails.",
      acceptanceCriteria: ["A failed backup alerts"],
      touches: [],
      blockedBy: [0],
    },
  ],
};

async function seeded(status: MilestoneStatus = "approved", path = "/") {
  const h = renderApp(path);
  await h.tracker.createProject({ name: "AI", key: "AI" });
  await h.milestones.create({
    id: "m4",
    projectId: "ai",
    name: "M4: Epics",
    outcome: "Epics work",
    order: 4,
    status,
    createdAt: AT,
    updatedAt: AT,
  });
  const epic = await h.service.create("ai", { type: "epic", title: "Backups" }, "andy");
  await h.tracker.updateTicket("ai", epic.id, { fields: { milestoneId: "m4" } }, "andy");
  return { h, epic };
}

async function withWaiting(path = "/") {
  const s = await seeded("approved", path);
  await s.h.epicBreakdowns.put(
    {
      projectId: "ai",
      epicId: s.epic.id,
      status: "proposed",
      proposal,
      proposedBy: "agent",
      proposedAt: AT,
      decidedBy: null,
      decidedAt: null,
      reason: null,
      ticketIds: [],
      approvalLeaseUntil: null,
      updatedAt: AT,
    },
    null,
  );
  await s.h.queryClient.invalidateQueries();
  return s;
}

async function openPanel(h: ReturnType<typeof renderApp>, key: string) {
  await h.router.navigate({ to: `/p/ai/t/${key}` });
  return screen.findByRole("region", { name: "Breakdown" }, PAGE_LOAD);
}

describe("epic breakdown on the epic panel (AI-383)", () => {
  it("GivenATopLevelEpicInAnApprovedMilestone_WhenAndyClicksDraftTickets_ThenTheAgentTaskIsRequestedAndTheApiMessageShows", async () => {
    const { h, epic } = await seeded();
    const section = await openPanel(h, epic.key);
    const button = await within(section).findByRole("button", { name: "Draft tickets" });
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(within(section).getByText(/An agent drafts this epic's tickets/)).toBeTruthy();

    await h.user.click(button);

    // The harness project has no repo, so the API refuses with its own message.
    expect(await within(section).findByText("project AI has no repo")).toBeTruthy();
  });

  it("GivenAnEpicInAParkedMilestone_WhenItsPanelOpens_ThenDraftTicketsIsDisabledWithTheReason", async () => {
    const { h, epic } = await seeded("parked");
    const section = await openPanel(h, epic.key);
    expect(
      (await within(section).findByRole("button", { name: "Draft tickets" })).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
    expect(
      within(section).getByText("M4: Epics is parked: approve it on the roadmap first."),
    ).toBeTruthy();
  });

  it("GivenAChildEpic_WhenItsPanelOpens_ThenThereIsNoBreakdown", async () => {
    const { h, epic } = await seeded();
    const child = await h.service.create(
      "ai",
      { type: "epic", title: "Restores", parentId: epic.id },
      "andy",
    );
    await h.router.navigate({ to: `/p/ai/t/${child.key}` });
    await screen.findByRole("region", { name: "Tickets" }, PAGE_LOAD);
    expect(screen.queryByRole("region", { name: "Breakdown" })).toBeNull();
  });

  it("GivenAPlanEpicTaskInFlight_WhenThePanelOpens_ThenItSaysTheTaskIsDraftingAndLinksIt", async () => {
    const { h, epic } = await seeded();
    const run = await h.runs.create({
      projectId: "ai",
      ticketId: epic.id,
      step: "plan-epic",
      route: DEFAULT_ROUTE,
      tier: null,
    });
    const section = await openPanel(h, epic.key);
    const link = await within(section).findByRole("link", { name: "Agent task · plan-epic" });
    expect(link.getAttribute("href")).toBe(`/p/ai/runs/${run.id}`);
    expect(within(section).queryByRole("button", { name: "Draft tickets" })).toBeNull();
  });

  it("GivenAWaitingDraft_WhenThePanelOpens_ThenEachTicketShowsItsFieldsAsPlainText", async () => {
    const { h, epic } = await withWaiting();
    const section = await openPanel(h, epic.key);
    expect(await within(section).findByText("Restore first, then alert.")).toBeTruthy();
    const first = within(section).getByRole("listitem", { name: "1. Restore drill **now**" });
    // Agent text is never markdown: the asterisks stay.
    expect(within(first).getByText("Restore drill **now**")).toBeTruthy();
    expect(within(first).getByText("Chore")).toBeTruthy();
    expect(within(first).getByText("S")).toBeTruthy();
    expect(within(first).getByText("A restore finishes")).toBeTruthy();
    expect(within(first).getByText("Touches: infra/backup")).toBeTruthy();
    const second = within(section).getByRole("listitem", { name: "2. Alert on a failed backup" });
    expect(within(second).getByText("Blocked by: 1. Restore drill **now**")).toBeTruthy();
  });

  it("GivenAWaitingDraft_WhenAndyApproves_ThenTheTicketsAreCreatedUnderTheEpic", async () => {
    const { h, epic } = await withWaiting();
    const section = await openPanel(h, epic.key);
    await h.user.click(
      await within(section).findByRole("button", { name: "Approve: create 2 tickets" }),
    );
    await waitFor(async () =>
      expect(
        (await h.tracker.listTickets("ai"))
          .filter((t) => t.parentId === epic.id)
          .map((t) => [t.title, t.stage]),
      ).toEqual([
        ["Restore drill **now**", "backlog"],
        ["Alert on a failed backup", "backlog"],
      ]),
    );
    expect(await within(section).findByText("Approved: 2 tickets created in Ideas.")).toBeTruthy();
  });

  it("GivenAWaitingDraft_WhenAndySendsItBackWithANote_ThenTheNoteShowsAndDraftingCanStartAgain", async () => {
    const { h, epic } = await withWaiting();
    const section = await openPanel(h, epic.key);
    const sendBack = await within(section).findByRole("button", { name: "Send back" });
    expect(sendBack.hasAttribute("disabled")).toBe(true);

    await h.user.type(
      within(section).getByRole("textbox", { name: "Note for the next draft" }),
      "Split the alert",
    );
    await h.user.click(sendBack);

    expect(await within(section).findByText("Split the alert")).toBeTruthy();
    expect(
      within(section).getByRole("button", { name: "Draft tickets again" }).hasAttribute("disabled"),
    ).toBe(false);
    expect((await h.epicBreakdowns.get("ai", epic.id))?.status).toBe("rejected");
  });
});

describe("epic breakdowns in the inbox (AI-383)", () => {
  it("GivenOnlyAWaitingDraft_WhenTheInboxOpens_ThenItLinksToTheEpicAndDoesNotSayNothingNeedsYou", async () => {
    const { epic } = await withWaiting("/all/inbox");
    const section = await screen.findByRole("region", { name: "Epic breakdowns" }, PAGE_LOAD);
    const link = within(section).getByRole("link", { name: /Backups/ });
    expect(link.getAttribute("href")).toBe(`/p/ai/t/${epic.key}`);
    expect(within(section).getByText("2 tickets drafted, waiting for you")).toBeTruthy();
    expect(screen.queryByText("Nothing needs you.")).toBeNull();
  });
});

describe("draftBlocker (AI-383)", () => {
  const epic = { key: "AI-1", stage: "backlog" as const, archived: false, milestoneId: "m4" };
  const approved = {
    id: "m4",
    projectId: "ai",
    name: "M4: Epics",
    outcome: "Epics work",
    order: 4,
    status: "approved" as const,
    createdAt: AT,
    updatedAt: AT,
  };
  const dispatched = { executor: { repo: "o/r", ref: "main", externalId: "1" }, localRun: null };

  it("GivenThreeDispatchedDrafts_WhenChecked_ThenTheEpicHasUsedItsDraftingTasks", () => {
    expect(draftBlocker(epic, [approved], [dispatched, dispatched, dispatched])).toMatch(
      /^Used its 3 drafting tasks/,
    );
  });

  it("GivenNoMilestone_WhenChecked_ThenItAsksForOne", () => {
    expect(draftBlocker({ ...epic, milestoneId: null }, [approved], [])).toBe(
      "Pick a milestone for this epic first.",
    );
  });

  it("GivenADoneEpic_WhenChecked_ThenItSaysSo", () => {
    expect(draftBlocker({ ...epic, stage: "done" }, [approved], [])).toBe("AI-1 is done.");
  });

  it("GivenAnApprovedMilestoneAndNoDrafts_WhenChecked_ThenNothingBlocks", () => {
    expect(draftBlocker(epic, [approved], [])).toBeNull();
  });
});
