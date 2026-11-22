import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Question, Ticket, WaitingMerge } from "@andy/contracts";
import { inboxCards } from "@andy/domain";
import { InboxPage } from "./InboxPage";

const base = {
  projectId: "ai",
  type: "chore",
  body: "Why",
  acceptanceCriteria: ["Done when it works"],
  size: "S",
  sizeReason: "small",
  archived: false,
  upNextRank: null,
};
const tickets = [
  {
    ...base,
    id: "b",
    key: "AI-2",
    title: "Other backlog",
    stage: "backlog",
    size: null,
    rank: "1",
  },
  { ...base, id: "a", key: "AI-1", title: "Near ready", stage: "backlog", rank: "2" },
  { ...base, id: "c", key: "AI-3", title: "Finished", stage: "done", rank: "3" },
] as Ticket[];
const questions = tickets.map(
  (t) =>
    ({
      id: `q-${t.id}`,
      ticketId: t.id,
      projectId: "ai",
      urgency: "normal",
      createdAt: "x",
    }) as Question,
);
const merge = (projectId: string, ticketKey: string): WaitingMerge => ({
  projectId,
  ticketKey,
  ticketTitle: `${ticketKey} title`,
  prNumber: 9,
  prUrl: "https://github.com/albernhagen/andy-intelligence/pull/9",
  mergeMode: "all-clean",
  reasons: ["kept_path", "mode_manual"],
  note: { whatChanged: "Lanes show.", howItWorks: "One read.", needsYou: null },
});
const data = {
  questions,
  tickets,
  waitingMerges: { merges: [merge("ai", "AI-9"), merge("ops", "OPS-1")], truncated: false },
};

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ projectId: "ai" }),
  Link: ({ children }: { children: unknown }) => <a>{children as string}</a>,
}));
vi.mock("@/lib/queries", () => ({
  useNeedsYou: () => ({ isPending: false, isError: false, data }),
  useProjects: () => ({ data: [] }),
}));
vi.mock("@/components/ProjectPlan", () => ({
  ProjectPlansWaiting: () => null,
  useWaitingPlans: () => ({ shown: [], error: null }),
}));
vi.mock("@/components/ConfigChanges", () => ({ ConfigChanges: () => null }));
vi.mock("@/components/inbox/InboxTicketCard", () => ({
  InboxTicketCard: ({ card }: { card: { ticket: Ticket } }) => (
    <article aria-label={card.ticket.key} />
  ),
}));

describe("InboxPage", () => {
  it("GivenAnInbox_WhenRendered_ThenCardsFollowTheSharedDomainOrder", () => {
    render(<InboxPage />);
    const { active, stale } = inboxCards(data, "ai");
    const expected = [...active, ...stale].map((c) => c.ticket!.key);
    expect(expected).toEqual(["AI-1", "AI-2", "AI-3"]);
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(
      expected,
    );
  });

  it("GivenAPrWaitingForAndysMerge_WhenRendered_ThenThisProjectsIsListedWithWhyAndItsNote", () => {
    render(<InboxPage />);
    const list = screen.getByRole("region", { name: "Waiting for your merge" });

    const items = within(list).getAllByRole("listitem");
    expect(items.map((i) => i.getAttribute("aria-label"))).toEqual(["AI-9: AI-9 title"]);
    expect(within(list).getByText("Yours: touches a kept path, manual mode")).toBeTruthy();
    expect(within(list).getByText("Lanes show.")).toBeTruthy();
    expect(within(list).getByRole("link", { name: "PR #9" }).getAttribute("href")).toBe(
      "https://github.com/albernhagen/andy-intelligence/pull/9",
    );
    // Three ticket questions plus the one merge.
    expect(screen.getByRole("heading", { name: /Needs you/ }).textContent).toBe("Needs you 4");
  });
});
