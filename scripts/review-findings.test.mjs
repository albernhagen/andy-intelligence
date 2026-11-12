/* global Response, console, URL */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { FINDING_KINDS } from "./review-gate.mjs";
import { LIMITS, main, verdictReport } from "./review-findings.mjs";

const SHA = "a".repeat(40);
const verdict = (findings) => JSON.stringify({ summary: "s", findings });
const f = (over = {}) => ({
  severity: "should-fix",
  kind: "missing-test",
  title: "No test",
  file: "a.ts",
  line: 3,
  scenario: "x",
  recommendation: "y",
  ...over,
});

describe("verdictReport", () => {
  it("GivenAVerdict_WhenReported_ThenOnlySeverityKindTitleAndFileAreSent", () => {
    expect(verdictReport(verdict([f()]), "adversarial", SHA)).toEqual({
      headSha: SHA,
      findings: [{ severity: "should-fix", kind: "missing-test", title: "No test", file: "a.ts" }],
    });
  });

  it("GivenAnUnknownOrMissingKind_WhenReported_ThenItIsOther", () => {
    const r = verdictReport(
      verdict([f({ kind: "made-up" }), f({ kind: undefined })]),
      "adversarial",
      SHA,
    );
    expect(r.findings.map((x) => x.kind)).toEqual(["other", "other"]);
  });

  it("GivenLongMultilineTextAndTooManyFindings_WhenReported_ThenCutToTheCapsMostSevereFirst", () => {
    const many = [
      ...Array.from({ length: LIMITS.findings }, () => f({ severity: "question" })),
      f({ severity: "blocker", title: `a\n\u0007b ${"x".repeat(400)}`, file: "" }),
    ];
    const r = verdictReport(verdict(many), "adversarial", SHA);
    expect(r.findings).toHaveLength(LIMITS.findings);
    expect(r.findings[0]).toMatchObject({ severity: "blocker", file: null });
    expect(r.findings[0].title.startsWith("a b ")).toBe(true);
    expect(r.findings[0].title.length).toBe(LIMITS.title);
  });

  it.each([
    ["no JSON", "nope", "adversarial", SHA],
    ["another role's severity", verdict([f({ severity: "high" })]), "adversarial", SHA],
    ["an unknown role", verdict([]), "other", SHA],
    ["a short SHA", verdict([]), "adversarial", "abc"],
  ])("GivenOutputWith%s_WhenReported_ThenNull", (_n, raw, role, sha) => {
    expect(verdictReport(raw, role, sha)).toBeNull();
  });
});

describe("main", () => {
  const env = {
    CONTROL_PLANE_URL: "https://cp.example",
    ROLE: "adversarial",
    FINDINGS: verdict([f()]),
    HEAD_SHA: SHA,
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.example/token?x=1",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token",
  };

  it("GivenAVerdict_WhenRun_ThenItPostsWithTheOidcTokenForTheControlPlaneAudience", async () => {
    const fetchImpl = vi.fn(async (url) =>
      new URL(String(url)).host === "oidc.example"
        ? new Response(JSON.stringify({ value: "jwt" }))
        : new Response("{}", { status: 201 }),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(env, fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://oidc.example/token?x=1&audience=https%3A%2F%2Fcp.example",
    );
    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe("https://cp.example/review/findings");
    expect(init.headers.authorization).toBe("Bearer jwt");
    expect(JSON.parse(init.body).findings).toHaveLength(1);
    expect(log.mock.calls.flat().join(" ")).not.toContain("jwt");
    log.mockRestore();
  });

  it("GivenTheControlPlaneFails_WhenRun_ThenAWarningAndNoThrow", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(env, async () => {
      throw new TypeError("fetch failed");
    });
    expect(log.mock.calls.flat().join(" ")).toContain("::warning title=review-findings::");
    log.mockRestore();
  });

  it("GivenNoControlPlaneUrl_WhenRun_ThenNothingIsFetched", async () => {
    const fetchImpl = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await main({ ...env, CONTROL_PLANE_URL: "" }, fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("review schemas", () => {
  it.each(["security", "adversarial"])(
    "GivenThe%sSchema_WhenRead_ThenItsKindListIsFindingKindsAndRequired",
    (role) => {
      const schema = JSON.parse(
        readFileSync(
          new URL(`../platform/procedures/${role}-review.schema.json`, import.meta.url),
          "utf8",
        ),
      );
      const item = schema.properties.findings.items;
      expect(item.properties.kind.enum).toEqual(FINDING_KINDS);
      expect(item.required).toContain("kind");
      for (const k of FINDING_KINDS) expect(k).toMatch(/^[a-z][a-z0-9-]{0,39}$/);
    },
  );
});
