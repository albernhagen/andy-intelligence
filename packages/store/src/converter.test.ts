import type { QueryDocumentSnapshot } from "@google-cloud/firestore";
import type { Ticket } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, collections, upgrade, zodConverter } from "./index";

const ticket: Ticket = {
  id: "t1",
  projectId: "p1",
  key: "AI-1",
  type: "feature",
  parentId: null,
  title: "Add board",
  body: "",
  acceptanceCriteria: ["WHEN a card is dropped THE SYSTEM SHALL persist its stage"],
  assumptions: [],
  stage: "backlog",
  rank: "a0",
  size: null,
  sizeReason: null,
  overrides: {},
  needsAttention: false,
  dorStatus: "not_met",
  blockedBy: [],
  archived: false,
  outOfScope: [],
  touches: [],
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
};

const snap = (data: Record<string, unknown>) =>
  ({ data: () => data }) as unknown as QueryDocumentSnapshot;

/** A ticket as stored before ticket model v2 (ADR-0058). */
const v1 = (fields: Record<string, unknown> = {}) => {
  const old: Record<string, unknown> = { ...ticket, type: "story", tier: "strong" };
  old.needsYou = old.needsAttention;
  for (const added of ["needsAttention", "outOfScope", "touches", "archived"]) delete old[added];
  return { ...old, ...fields, _v: 1 };
};

describe("zodConverter", () => {
  const conv = zodConverter(collections.tickets.schema, collections.tickets.upgraders);

  it("stamps the schema version on write", () => {
    expect(conv.toFirestore(ticket)).toMatchObject({ _v: SCHEMA_VERSION, key: "AI-1" });
  });

  it("rejects invalid documents on write", () => {
    expect(() => conv.toFirestore({ ...ticket, key: "not a key" } as Ticket)).toThrow();
  });

  it("strips the version and validates on read", () => {
    expect(conv.fromFirestore(snap({ ...ticket, _v: SCHEMA_VERSION }))).toEqual(ticket);
    expect(() => conv.fromFirestore(snap({ ...ticket, stage: "nope" }))).toThrow();
  });

  it("GivenATicketWrittenBeforeArchiving_WhenRead_ThenItIsNotArchived", () => {
    const older: Partial<Ticket> = { ...ticket };
    delete older.archived;
    expect(conv.fromFirestore(snap({ ...older, _v: SCHEMA_VERSION }))).toEqual(ticket);
  });

  it.each([
    ["story", "feature"],
    ["task", "chore"],
    ["bug", "bug"],
    ["epic", "epic"],
  ])("GivenAV1TicketOfType%s_WhenRead_ThenItIs%s", (stored, read) => {
    expect(conv.fromFirestore(snap(v1({ type: stored }))).type).toBe(read);
  });

  it.each([true, false])(
    "GivenAV1TicketWithNeedsYou%s_WhenRead_ThenNeedsAttentionIsTheSame",
    (flag) => {
      const read = conv.fromFirestore(snap(v1({ needsYou: flag })));
      expect(read.needsAttention).toBe(flag);
      expect(read).not.toHaveProperty("needsYou");
    },
  );

  it("GivenAV1Ticket_WhenRead_ThenTierIsDroppedAndScopeListsAreEmpty", () => {
    const read = conv.fromFirestore(snap(v1()));
    expect(read).toEqual(ticket);
    expect(read).not.toHaveProperty("tier");
  });

  it("GivenAV1TicketWithATierOverride_WhenRead_ThenTheOverrideStays", () => {
    const read = conv.fromFirestore(snap(v1({ overrides: { tier: "frontier" } })));
    expect(read.overrides).toEqual({ tier: "frontier" });
  });

  it("GivenATicketWithoutAVersion_WhenRead_ThenItIsUpgradedAsV1", () => {
    const { _v, ...unversioned } = v1();
    expect(_v).toBe(1);
    expect(conv.fromFirestore(snap(unversioned))).toEqual(ticket);
  });

  it("GivenAV1Ticket_WhenReadAndWrittenBack_ThenItIsStoredInTheV2Shape", () => {
    const written = conv.toFirestore(conv.fromFirestore(snap(v1())));
    expect(written).toMatchObject({ _v: 2, type: "feature", needsAttention: false });
    expect(written).not.toHaveProperty("needsYou");
    expect(written).not.toHaveProperty("tier");
  });

  it("GivenAV2Ticket_WhenUpgraded_ThenItIsUnchanged", () => {
    const stored = { ...ticket, type: "chore" };
    expect(upgrade(stored, 2, collections.tickets.upgraders)).toBe(stored);
  });

  it("nests ticket history under the ticket", () => {
    expect(collections.ticketEvents.path("p1", "t1")).toBe("projects/p1/tickets/t1/events");
  });
});
