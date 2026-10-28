import type { QueryDocumentSnapshot } from "@google-cloud/firestore";
import type { Ticket } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, collections, zodConverter } from "./index";

const ticket: Ticket = {
  id: "t1",
  projectId: "p1",
  key: "AI-1",
  type: "story",
  parentId: null,
  title: "Add board",
  body: "",
  acceptanceCriteria: ["WHEN a card is dropped THE SYSTEM SHALL persist its stage"],
  assumptions: [],
  stage: "backlog",
  rank: "a0",
  size: null,
  tier: null,
  overrides: {},
  needsYou: false,
  dorStatus: "not_met",
  blockedBy: [],
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
};

const snap = (data: Record<string, unknown>) =>
  ({ data: () => data }) as unknown as QueryDocumentSnapshot;

describe("zodConverter", () => {
  const conv = zodConverter(collections.tickets.schema);

  it("stamps the schema version on write", () => {
    expect(conv.toFirestore(ticket)).toMatchObject({ _v: SCHEMA_VERSION, key: "AI-1" });
  });

  it("rejects invalid documents on write", () => {
    expect(() => conv.toFirestore({ ...ticket, key: "not a key" } as Ticket)).toThrow();
  });

  it("strips the version and validates on read", () => {
    expect(conv.fromFirestore(snap({ ...ticket, _v: 1 }))).toEqual(ticket);
    expect(() => conv.fromFirestore(snap({ ...ticket, stage: "nope" }))).toThrow();
  });

  it("nests ticket history under the ticket", () => {
    expect(collections.ticketEvents.path("p1", "t1")).toBe("projects/p1/tickets/t1/events");
  });
});
