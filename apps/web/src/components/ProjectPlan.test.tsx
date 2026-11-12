import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";

/** AI-108: a seeded project plan in the inbox and on the settings page, against the in-process API. */

const plan = {
  status: "proposed" as const,
  proposal: {
    summary: "Skeleton first.",
    milestones: [
      {
        title: "Walking skeleton",
        goal: "Andy can open it.",
        doneWhen: ["URL loads"],
        slices: ["CI"],
      },
      { title: "Log a run", goal: "Andy logs a run.", doneWhen: ["Run listed"], slices: ["Form"] },
    ],
  },
  proposedBy: "user:andy",
  proposedAt: "2026-11-12T10:00:00.000Z",
  decidedBy: null,
  decidedAt: null,
  reason: null,
  epicIds: [],
};

async function open(path: string) {
  const h = renderApp(path);
  await h.tracker.createProject({ name: "Trail log", key: "TRL" });
  await h.tracker.updateProject("trl", { projectPlan: plan });
  await h.queryClient.invalidateQueries();
  return h;
}

describe("project plan", () => {
  it("GivenAWaitingPlan_WhenAndyApprovesFromTheInbox_ThenTheEpicsAreCreatedInOrder", async () => {
    const h = await open("/all/inbox");
    const section = await screen.findByRole("region", { name: "Project plans" });
    expect(within(section).getByText("TRL: Trail log: plan waiting for you")).toBeTruthy();
    await h.user.click(within(section).getByRole("button", { name: "Approve: create 2 epics" }));
    await waitFor(async () =>
      expect((await h.tracker.listTickets("trl")).map((t) => t.title)).toEqual([
        "M1: Walking skeleton",
        "M2: Log a run",
      ]),
    );
  });

  it("GivenAWaitingPlan_WhenAndyRejectsOnTheSettingsPage_ThenNoTicketsAndTheReasonShows", async () => {
    const h = await open("/p/trl/settings");
    const section = await screen.findByRole("region", { name: "Project plan" });
    const reject = within(section).getByRole("button", { name: "Reject" }) as HTMLButtonElement;
    expect(reject.disabled).toBe(true);
    await h.user.type(within(section).getByLabelText("Reason to reject"), "Too big");
    await h.user.click(reject);
    expect(await within(section).findByText("Too big")).toBeTruthy();
    expect(await h.tracker.listTickets("trl")).toEqual([]);
  });

  it("GivenOnlyAWaitingPlan_WhenTheInboxOpens_ThenItCountsOneAndDoesNotSayNothingNeedsYou", async () => {
    await open("/all/inbox");
    await screen.findByRole("region", { name: "Project plans" });
    expect(screen.queryByText("Nothing needs you.")).toBeNull();
    expect(screen.getByRole("heading", { name: /Needs you/ }).textContent).toContain("1");
  });
});
