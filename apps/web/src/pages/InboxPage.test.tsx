import { fireEvent, render, screen, within } from "@testing-library/react";
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
  queue: null,
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
/** AI-388: the Merge button's mutation; a test sets what it answers. */
const mergeMutation = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null as unknown,
  data: undefined as unknown,
}));
vi.mock("@/lib/queries", () => ({
  useNeedsYou: () => ({ isPending: false, isError: false, data }),
  useProjects: () => ({ data: [] }),
  useMergePr: () => mergeMutation,
}));
vi.mock("@/components/ProjectPlan", () => ({
  ProjectPlansWaiting: () => null,
  useWaitingPlans: () => ({ shown: [], error: null }),
}));
vi.mock("@/components/EpicBreakdown", () => ({
  EpicBreakdownsWaiting: () => null,
  useWaitingBreakdowns: () => ({ shown: [], error: null }),
}));
vi.mock("@/components/ConfigChanges", () => ({ ConfigChanges: () => null }));
vi.mock("@/components/inbox/InboxTicketCard", () => ({
  InboxTicketCard: ({ card }: { card: { ticket: Ticket } }) => (
    <article aria-label={card.ticket.key} />
  ),
}));

describe("InboxPage", () => {
  it("GivenAnInbox_WhenRendered_ThenRowsFollowTheSharedDomainOrder", () => {
    render(<InboxPage />);
    const { active, stale } = inboxCards(data, "ai");
    const expected = [...active, ...stale].map((c) => `${c.ticket!.key}: ${c.ticket!.title}`);
    expect(expected).toEqual(["AI-1: Near ready", "AI-2: Other backlog", "AI-3: Finished"]);
    const rows = screen
      .getAllByRole("button")
      .filter((b) => b.hasAttribute("data-nav-item"))
      .map((b) => b.getAttribute("aria-label"));
    // This project's merge first, then the tickets (AI-371: list beside detail).
    expect(rows).toEqual(["AI-9: AI-9 title", ...expected]);
  });

  it("GivenAPrWaitingForAndysMerge_WhenRendered_ThenThisProjectsIsListedWithWhyAndItsNote", () => {
    render(<InboxPage />);
    const list = screen.getByRole("region", { name: "Waiting for your merge" });
    expect(within(list).getByRole("button", { name: "AI-9: AI-9 title" }).textContent).toContain(
      "PR #9 · touches a kept path, manual mode",
    );

    // First in the list, so it is picked: the detail says why it is Andy's, with its note.
    const detail = screen.getByRole("article", { name: "AI-9: AI-9 title" });
    expect(within(detail).getByText("Yours: touches a kept path, manual mode")).toBeTruthy();
    expect(within(detail).getByText("Lanes show.")).toBeTruthy();
    expect(within(detail).getByRole("link", { name: "PR #9" }).getAttribute("href")).toBe(
      "https://github.com/albernhagen/andy-intelligence/pull/9",
    );
    // Three tickets, as the header counts them; the merge has its own heading (AI-347).
    expect(screen.getByRole("heading", { name: /Needs you/ }).textContent).toBe("Needs you 3");
  });

  it("GivenAPrWaitingForAndysMerge_WhenHeClicksMerge_ThenItAsksForThatRepoAndPr", () => {
    mergeMutation.mutate.mockClear();
    mergeMutation.data = undefined;
    render(<InboxPage />);
    const detail = screen.getByRole("article", { name: "AI-9: AI-9 title" });
    fireEvent.click(within(detail).getByRole("button", { name: "Merge PR #9" }));
    expect(mergeMutation.mutate).toHaveBeenCalledWith({
      repo: "albernhagen/andy-intelligence",
      number: 9,
    });
  });

  it("GivenTheMergeIsQueued_WhenRendered_ThenItSaysItsPlaceAndWhatTheQueueWaitsFor", () => {
    mergeMutation.data = {
      merged: false,
      queued: true,
      queuePosition: 1,
      queueNote: "sync requested",
      reasons: [],
      number: 9,
    };
    render(<InboxPage />);
    expect(screen.getByRole("status").textContent).toBe("In the merge queue: #1 · sync requested");
    mergeMutation.data = undefined;
  });

  it("GivenTheMergeStillWaits_WhenRendered_ThenItSaysWhatHoldsItInWords", () => {
    mergeMutation.data = {
      merged: false,
      queued: false,
      queuePosition: null,
      queueNote: null,
      reasons: ["gate_not_clean", "main_red"],
      number: 9,
    };
    render(<InboxPage />);
    expect(screen.getByRole("status").textContent).toBe(
      "Not merged: checks or reviews haven't all passed, main is red",
    );
    mergeMutation.data = undefined;
  });
});
