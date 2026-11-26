import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  VERIFY_CAP_MINUTES,
  VERIFY_LIMITS,
  VerifyVerdict,
  type CriterionCheck,
  type TicketVerdict,
} from "./verify";

const read = (file: string) =>
  readFileSync(new URL(`../../../../platform/procedures/${file}`, import.meta.url), "utf8");

// The schema the verify agent gets; VerifyVerdict is the control plane's check.
const schema = JSON.parse(read("verify.schema.json"));
const testItem = schema.properties.tests.items;
const ticketItem = schema.properties.tickets.items;
const criterionItem = ticketItem.properties.criteria.items;
const evidenceItem = criterionItem.properties.evidence.items;

const check = (over: Partial<CriterionCheck> = {}): CriterionCheck => ({
  criterion: "When a visitor opens /, the system shall show the board.",
  result: "pass",
  reason: "",
  evidence: [{ kind: "response", detail: "GET / → 200, <h1>Board</h1>" }],
  ...over,
});
const ticket = (over: Partial<TicketVerdict> = {}): TicketVerdict => ({
  key: "AI-1",
  verdict: "pass",
  criteria: [check()],
  ...over,
});
const verdict = (over: Partial<VerifyVerdict> = {}): VerifyVerdict => ({
  summary: "Pass: one ticket checked.",
  verdict: "pass",
  tests: [{ command: "pnpm test:e2e", passed: true, output: "3 passed" }],
  tickets: [ticket()],
  ...over,
});
const messages = (input: unknown) =>
  VerifyVerdict.safeParse(input).error?.issues.map((i) => i.message) ?? [];

describe("VerifyVerdict", () => {
  it("GivenTheAgentSchema_WhenComparedWithTheCheck_ThenTheCapsAndFieldsMatch", () => {
    expect(schema.properties.summary.maxLength).toBe(VERIFY_LIMITS.summary);
    expect(schema.properties.tickets.maxItems).toBe(VERIFY_LIMITS.tickets);
    expect(schema.properties.tests.maxItems).toBe(VERIFY_LIMITS.tests);
    expect(testItem.properties.command.maxLength).toBe(VERIFY_LIMITS.command);
    expect(testItem.properties.output.maxLength).toBe(VERIFY_LIMITS.output);
    expect(ticketItem.properties.criteria.maxItems).toBe(VERIFY_LIMITS.criteria);
    expect(criterionItem.properties.criterion.maxLength).toBe(VERIFY_LIMITS.criterion);
    expect(criterionItem.properties.reason.maxLength).toBe(VERIFY_LIMITS.reason);
    expect(criterionItem.properties.evidence.maxItems).toBe(VERIFY_LIMITS.evidence);
    expect(evidenceItem.properties.detail.maxLength).toBe(VERIFY_LIMITS.detail);
    expect(evidenceItem.properties.kind.enum).toEqual([
      "request",
      "response",
      "screenshot",
      "test",
      "log",
      "note",
    ]);
    expect(criterionItem.properties.result.enum).toEqual(["pass", "fail", "skipped"]);
    expect(schema.required.sort()).toEqual(Object.keys(verdict()).sort());
    expect(ticketItem.required.sort()).toEqual(Object.keys(ticket()).sort());
    expect(criterionItem.required.sort()).toEqual(Object.keys(check()).sort());
  });

  it("GivenTheProcedure_WhenRead_ThenItStatesNoWriteToolsAndTheCap", () => {
    const procedure = read("verify.md");
    expect(procedure).toContain("**No write tools.**");
    expect(procedure).toContain(`**${VERIFY_CAP_MINUTES}-minute cap.**`);
    expect(procedure).toContain("verify.schema.json");
  });

  it("GivenAValidVerdict_WhenParsed_ThenAccepted", () => {
    expect(VerifyVerdict.safeParse(verdict()).success).toBe(true);
  });

  it("GivenNoTestsAndASkippedCriterionWithAReason_WhenParsed_ThenThePassIsAccepted", () => {
    const skipped = check({ result: "skipped", reason: "needs sign-in", evidence: [] });
    const input = verdict({ tests: [], tickets: [ticket({ criteria: [check(), skipped] })] });
    expect(VerifyVerdict.safeParse(input).success).toBe(true);
  });

  it("GivenEveryCriterionSkipped_WhenParsed_ThenTheTicketPasses", () => {
    // Andy's rule (2026-11-26): skipped never fails a ticket; the summary names such tickets.
    const skipped = check({ result: "skipped", reason: "needs sign-in", evidence: [] });
    const input = verdict({ tickets: [ticket({ criteria: [skipped, skipped] })] });
    expect(VerifyVerdict.safeParse(input).success).toBe(true);
    const asFailed = verdict({ tickets: [ticket({ verdict: "fail", criteria: [skipped] })] });
    expect(messages(asFailed)).toContain("verdict must be pass");
  });

  it("GivenATicketWithNoCriteria_WhenItGetsOneSkippedEntry_ThenAccepted", () => {
    const none = check({
      criterion: "none",
      result: "skipped",
      reason: "no criteria",
      evidence: [],
    });
    expect(
      VerifyVerdict.safeParse(verdict({ tickets: [ticket({ criteria: [none] })] })).success,
    ).toBe(true);
    expect(VerifyVerdict.safeParse(verdict({ tickets: [ticket({ criteria: [] })] })).success).toBe(
      false,
    );
  });

  it("GivenTwentyCriteria_WhenParsed_ThenAcceptedAndOneMoreIsRefused", () => {
    const many = (n: number) => Array.from({ length: n }, () => check());
    const input = (n: number) => verdict({ tickets: [ticket({ criteria: many(n) })] });
    expect(VerifyVerdict.safeParse(input(VERIFY_LIMITS.criteria)).success).toBe(true);
    expect(VerifyVerdict.safeParse(input(VERIFY_LIMITS.criteria + 1)).success).toBe(false);
  });

  it("GivenAFailingCriterionInAPassingTicket_WhenParsed_ThenRefused", () => {
    const input = verdict({ tickets: [ticket({ criteria: [check({ result: "fail" })] })] });
    expect(messages(input)).toContain("verdict must be fail");
  });

  it("GivenAFailingTicketInAPassingRelease_WhenParsed_ThenRefused", () => {
    const failed = ticket({ verdict: "fail", criteria: [check({ result: "fail" })] });
    expect(messages(verdict({ tickets: [failed] }))).toEqual(["verdict must be fail"]);
    expect(VerifyVerdict.safeParse(verdict({ verdict: "fail", tickets: [failed] })).success).toBe(
      true,
    );
  });

  it("GivenAFailedTestInAPassingRelease_WhenParsed_ThenRefused", () => {
    const tests = [{ command: "pnpm test:e2e", passed: false, output: "1 failed" }];
    expect(messages(verdict({ tests }))).toEqual(["verdict must be fail"]);
  });

  it("GivenAFailedReleaseWithNothingFailing_WhenParsed_ThenRefused", () => {
    expect(messages(verdict({ verdict: "fail" }))).toEqual(["verdict must be pass"]);
  });

  it("GivenAPassWithoutEvidence_WhenParsed_ThenRefused", () => {
    const input = verdict({ tickets: [ticket({ criteria: [check({ evidence: [] })] })] });
    expect(messages(input)).toContain("pass or fail needs evidence");
  });

  it("GivenASkipWithoutAReason_WhenParsed_ThenRefused", () => {
    const skipped = check({ result: "skipped", reason: " ", evidence: [] });
    const input = verdict({ tickets: [ticket({ criteria: [skipped] })] });
    expect(messages(input)).toContain("a skipped check needs a reason");
  });

  it("GivenTheSameTicketTwice_WhenParsed_ThenRefused", () => {
    expect(messages(verdict({ tickets: [ticket(), ticket()] }))).toContain(
      "ticket keys must be unique",
    );
  });

  it("GivenAnExtraFieldOrAnUnknownEvidenceKind_WhenParsed_ThenRefused", () => {
    expect(VerifyVerdict.safeParse({ ...verdict(), moveTickets: true }).success).toBe(false);
    const evidence = [{ kind: "cookie", detail: "x" }] as unknown as CriterionCheck["evidence"];
    const input = verdict({ tickets: [ticket({ criteria: [check({ evidence })] })] });
    expect(VerifyVerdict.safeParse(input).success).toBe(false);
  });

  it("GivenEvidenceOverTheCap_WhenParsed_ThenRefused", () => {
    const evidence = [{ kind: "note" as const, detail: "x".repeat(VERIFY_LIMITS.detail + 1) }];
    const input = verdict({ tickets: [ticket({ criteria: [check({ evidence })] })] });
    expect(VerifyVerdict.safeParse(input).success).toBe(false);
  });
});
