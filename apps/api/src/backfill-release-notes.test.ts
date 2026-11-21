import { InMemoryReleaseNoteStore } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { applyBackfill, backfillNotes, type MergedPr } from "./backfill-release-notes";

const NOW = new Date("2026-11-20T12:00:00.000Z");
const project = { id: "ai", key: "AI" };
const tickets = [{ key: "AI-85", title: "Epic panel", risk: "low" as const }];

const pr = (overrides: Partial<MergedPr>): MergedPr => ({
  number: 150,
  title: "AI-85: Epic panel",
  body: "https://ai.andybernhagen.com/p/ai/t/AI-85\n\n## Summary\n\nAdds the epic panel. More.",
  url: "https://github.com/albernhagen/andy-intelligence/pull/150",
  mergedAt: "2026-11-12T10:00:00Z",
  mergedBy: { login: "albernhagen" },
  headRefName: "m4.1/epic-panel",
  files: [{ path: "docs/features/epics.md" }, { path: "apps/web/src/x.tsx" }],
  ...overrides,
});

describe("backfill", () => {
  it("GivenAPrWithASummary_WhenBackfilled_ThenItsFirstSentenceMarkedBackfill", () => {
    const [note] = backfillNotes([pr({})], project, tickets, NOW);
    expect(note).toMatchObject({
      id: "pr-150",
      source: "backfill",
      whatChanged: "Adds the epic panel.",
      howItWorks: null,
      ticketKey: "AI-85",
      ticketTitle: "Epic panel",
      mergedBy: "albernhagen",
      recordedAt: NOW.toISOString(),
    });
    expect(note?.links.map((l) => l.path)).toEqual(["docs/features/epics.md"]);
  });

  it("GivenAPrWithABlock_WhenBackfilled_ThenTheBlockStillMarkedBackfill", () => {
    const body = "What changed: A panel.\nHow it works: A route.";
    const [note] = backfillNotes([pr({ body })], project, tickets, NOW);
    expect(note).toMatchObject({
      source: "backfill",
      whatChanged: "A panel.",
      howItWorks: "A route.",
    });
  });

  it("GivenAnEmptyBody_WhenBackfilled_ThenTheTitleStandsIn", () => {
    const [note] = backfillNotes([pr({ body: "", headRefName: "dependabot/x" })], project, [], NOW);
    expect(note).toMatchObject({ whatChanged: "AI-85: Epic panel", ticketKey: null });
  });

  it("GivenMorePrsThanTheCap_WhenBackfilled_ThenItRefusesInsteadOfCutting", () => {
    const prs = Array.from({ length: 301 }, (_, i) => pr({ number: i + 1 }));
    expect(() => backfillNotes(prs, project, tickets, NOW)).toThrow(/more than 300/);
  });

  it("GivenAStoredNote_WhenApplied_ThenItIsNotOverwritten", async () => {
    const store = new InMemoryReleaseNoteStore();
    const [note] = backfillNotes([pr({})], project, tickets, NOW);
    await store.put({ ...note!, source: "note", whatChanged: "From the webhook." });
    const second = backfillNotes(
      [pr({ number: 151, url: `${pr({}).url.slice(0, -3)}151` })],
      project,
      tickets,
      NOW,
    );
    expect(await applyBackfill(store, [note!, ...second])).toEqual({ created: 1, exists: 1 });
    expect((await store.get("ai", "pr-150"))?.whatChanged).toBe("From the webhook.");
  });
});
