import { describe, expect, it } from "vitest";
import { spendEntryDocId, spendTotalDocId, spendTotalDocIds } from "./spend-ledger";

/**
 * The spend ledger's Firestore document layout (AI-247, AI-280), pinned without the emulator:
 * reads and writes build ids with the same helper, and this keeps the stored names stable.
 */

const AT = "2026-11-21T12:00:00.000Z";

describe("spendTotalDocIds", () => {
  it("GivenAnEntry_WhenItsTotalsAreNamed_ThenProjectGlobalAndProviderSplitsForDayAndMonth", () => {
    expect(spendTotalDocIds("ai", AT, "openrouter")).toEqual({
      projectDay: "project:ai|day:2026-11-21",
      projectMonth: "project:ai|month:2026-11",
      globalDay: "global|day:2026-11-21",
      globalMonth: "global|month:2026-11",
      projectProviderDay: "project:ai|provider:openrouter|day:2026-11-21",
      projectProviderMonth: "project:ai|provider:openrouter|month:2026-11",
      globalProviderDay: "global|provider:openrouter|day:2026-11-21",
      globalProviderMonth: "global|provider:openrouter|month:2026-11",
    });
  });

  it("GivenTheReadSideHelper_WhenNamingTheSameTotals_ThenTheIdsMatchTheWriteSide", () => {
    const written = spendTotalDocIds("ai", AT, "claude-sub");
    expect(spendTotalDocId({ projectId: "ai", provider: "claude-sub" }, "day", AT)).toBe(
      written.projectProviderDay,
    );
    expect(spendTotalDocId({ provider: "claude-sub" }, "month", AT)).toBe(
      written.globalProviderMonth,
    );
    expect(spendTotalDocId({}, "day", AT)).toBe(written.globalDay);
  });

  it("GivenIdsWithSlashes_WhenNamed_ThenNoSlashReachesADocumentId", () => {
    expect(spendTotalDocId({ projectId: "a/b", provider: "x/y" }, "day", AT)).not.toContain("/");
    expect(spendEntryDocId("run/1")).toMatch(/^[0-9a-f]{64}$/);
  });
});
