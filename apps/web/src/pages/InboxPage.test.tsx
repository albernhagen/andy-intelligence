import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Question, Ticket } from "@andy/contracts";
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
const data = { questions, tickets };

vi.mock("@tanstack/react-router", () => ({ useParams: () => ({ projectId: "ai" }) }));
vi.mock("@/lib/queries", () => ({
  useNeedsYou: () => ({ isPending: false, isError: false, data }),
  useProjects: () => ({ data: [] }),
}));
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
});
