import { readFileSync } from "node:fs";
import type { ModelOutcome, Tier } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { MIN_OUTCOME_TASKS, parseModelList, scoutProposal } from "./model-scout";
import { MODEL_SCOUT_LIMITS } from "@andy/contracts";

/** OpenRouter's public models list, trimmed to a few models (fixture data, not instructions). */
const LIST: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/openrouter-models.json", import.meta.url), "utf8"),
);

const tier = (
  key: Tier["key"],
  model: string,
  provider: "openrouter" | "claude-sub" = "openrouter",
): Tier => ({
  key,
  routes: [{ harness: "opencode", provider, model }],
});
const outcomes = (entries: [string, number, number][]) =>
  new Map<string, ModelOutcome>(
    entries.map(([m, tasks, successRate]) => [m, { tasks, successRate }]),
  );

describe("model scout: models list (AI-237)", () => {
  it("GivenTheFixture_WhenParsed_ThenGoodModelsInUsdPerMillionAndBadOnesSkipped", () => {
    const list = parseModelList(LIST);

    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.models.map((m) => m.id)).toContain("anthropic/claude-sonnet-4.5");
    expect(list.models.find((m) => m.id === "anthropic/claude-sonnet-4.5")).toEqual({
      id: "anthropic/claude-sonnet-4.5",
      name: "Anthropic: Claude Sonnet 4.5",
      contextTokens: 1000000,
      priceInPerMTokUsd: 3,
      priceOutPerMTokUsd: 15,
    });
    // Variable price (-1), no pricing, and an id that isn't a model id.
    expect(list.skipped).toBe(3);
    expect(list.models.some((m) => m.id.includes(" "))).toBe(false);
  });

  it.each([null, "text", { models: [] }, { data: "nope" }])(
    "GivenAListThatFailsToParse_WhenParsed_ThenAnError: %j",
    (raw) => {
      expect(parseModelList(raw)).toMatchObject({
        ok: false,
        error: expect.stringContaining("models list"),
      });
    },
  );
});

describe("model scout: proposal (AI-237)", () => {
  it("GivenACheaperModelWithEqualOrBetterOutcomes_WhenScouted_ThenProposedWithARationale", () => {
    const result = scoutProposal(
      LIST,
      [tier("strong", "anthropic/claude-opus-4.1")],
      outcomes([
        ["anthropic/claude-opus-4.1", 20, 0.8],
        ["openai/gpt-5", 12, 0.85],
        ["qwen/qwen3-coder", 10, 0.6],
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal).toMatchObject({
      entity: "tiers",
      entityId: "global",
      changes: [
        {
          tier: "strong",
          kind: "cheaper",
          from: { model: "anthropic/claude-opus-4.1" },
          to: { harness: "opencode", provider: "openrouter", model: "openai/gpt-5" },
        },
      ],
      diff: {
        strong: { kind: "cheaper", from: "anthropic/claude-opus-4.1", to: "openai/gpt-5" },
      },
    });
    expect(result.proposal!.changes[0]!.rationale).toContain("85% of 12 tasks");
    expect(result.proposal!.reason).toMatch(/^strong: openai\/gpt-5 costs/);
  });

  it("GivenACheaperModelWithWorseOutcomes_WhenScouted_ThenNothingIsProposed", () => {
    const result = scoutProposal(
      LIST,
      [tier("strong", "anthropic/claude-sonnet-4.5")],
      outcomes([
        ["anthropic/claude-sonnet-4.5", 20, 0.8],
        ["qwen/qwen3-coder", 30, 0.7],
      ]),
    );

    expect(result).toEqual({
      ok: true,
      proposal: null,
      skipped: 3,
      truncated: false,
      unchecked: [],
    });
  });

  it("GivenTooFewOutcomes_WhenScouted_ThenPriceAloneNeverSwapsAModel", () => {
    const few = MIN_OUTCOME_TASKS - 1;
    const result = scoutProposal(
      LIST,
      [tier("strong", "anthropic/claude-sonnet-4.5")],
      outcomes([
        ["anthropic/claude-sonnet-4.5", 20, 0.8],
        ["openai/gpt-5", few, 1],
      ]),
    );

    expect(result).toMatchObject({ ok: true, proposal: null });
  });

  it("GivenASmallerContext_WhenScouted_ThenTheCandidateDoesNotQualify", () => {
    const result = scoutProposal(
      LIST,
      [tier("fast", "google/gemini-2.5-flash")],
      outcomes([
        ["google/gemini-2.5-flash", 10, 0.7],
        ["qwen/qwen3-coder", 10, 0.9],
      ]),
    );

    expect(result).toMatchObject({ ok: true, proposal: null });
  });

  it("GivenATierModelNoLongerListed_WhenScouted_ThenAReplacementIsProposed", () => {
    const result = scoutProposal(
      LIST,
      [tier("cheap", "mistralai/retired-model")],
      outcomes([
        ["mistralai/retired-model", 10, 0.6],
        ["deepseek/deepseek-chat-v3.1", 10, 0.7],
        ["openai/gpt-5", 10, 0.9],
      ]),
    );

    if (!result.ok) throw new Error(result.error);
    expect(result.proposal!.changes).toEqual([
      expect.objectContaining({
        tier: "cheap",
        kind: "gone",
        to: expect.objectContaining({ model: "deepseek/deepseek-chat-v3.1" }),
      }),
    ]);
  });

  it("GivenATierModelGoneAndNoCandidate_WhenScouted_ThenTheTierIsFlagged", () => {
    const result = scoutProposal(LIST, [tier("cheap", "mistralai/retired-model")], new Map());

    if (!result.ok) throw new Error(result.error);
    expect(result.proposal!.changes[0]).toMatchObject({ kind: "gone", to: null });
    expect(result.proposal!.changes[0]!.rationale).toContain("pick one by hand");
  });

  it("GivenAPriceChangeOverTenPercent_WhenScouted_ThenTheNewPriceIsProposed", () => {
    const known = [{ id: "openai/gpt-5", priceInPerMTokUsd: 2.5, priceOutPerMTokUsd: 20 }];

    const result = scoutProposal(LIST, [tier("strong", "openai/gpt-5")], new Map(), known);

    if (!result.ok) throw new Error(result.error);
    expect(result.proposal!.changes[0]).toMatchObject({
      kind: "price_change",
      to: { model: "openai/gpt-5" },
      prices: { inPerMTokUsd: 1.25, outPerMTokUsd: 10 },
    });
  });

  it("GivenNothingWouldChange_WhenScouted_ThenNothingIsProposed", () => {
    const known = [{ id: "openai/gpt-5", priceInPerMTokUsd: 1.25, priceOutPerMTokUsd: 10 }];

    const result = scoutProposal(
      LIST,
      [tier("strong", "openai/gpt-5"), tier("fast", "sonnet", "claude-sub")],
      outcomes([["openai/gpt-5", 10, 0.9]]),
      known,
    );

    expect(result).toEqual({
      ok: true,
      proposal: null,
      skipped: 3,
      truncated: false,
      unchecked: [],
    });
  });

  it("GivenASubscriptionTier_WhenScouted_ThenItIsNotScouted", () => {
    const result = scoutProposal(LIST, [tier("fast", "retired", "claude-sub")], new Map());

    expect(result).toMatchObject({ ok: true, proposal: null });
  });

  it("GivenAListThatFailsToParse_WhenScouted_ThenNothingIsProposedAndTheErrorReturns", () => {
    const result = scoutProposal({ data: 42 }, [tier("strong", "openai/gpt-5")], new Map());

    expect(result).toEqual({ ok: false, error: expect.stringContaining("models list: data") });
  });

  it("GivenATierOnAListedButUnpricedModel_WhenScouted_ThenItIsUncheckedNotGone", () => {
    const result = scoutProposal(
      LIST,
      [tier("fast", "openrouter/auto")],
      outcomes([
        ["openrouter/auto", 10, 0.5],
        ["openai/gpt-5", 10, 0.9],
      ]),
    );

    expect(result).toMatchObject({
      ok: true,
      proposal: null,
      unchecked: [{ tier: "fast", model: "openrouter/auto", reason: "unpriced" }],
    });
  });

  it("GivenAListOverTheCap_WhenScouted_ThenTruncatedAndAMissingModelIsUncheckedNotGone", () => {
    const filler = Array.from({ length: MODEL_SCOUT_LIMITS.maxModels }, (_, i) => ({
      id: `filler/model-${i}`,
      pricing: { prompt: "0.000001", completion: "0.000002" },
    }));
    const late = { id: "late/model", pricing: { prompt: "0.000001", completion: "0.000002" } };

    const result = scoutProposal(
      { data: [...filler, late] },
      [tier("cheap", "late/model")],
      new Map(),
    );

    expect(result).toMatchObject({
      ok: true,
      proposal: null,
      truncated: true,
      unchecked: [{ tier: "cheap", model: "late/model", reason: "list_truncated" }],
    });
  });

  it("GivenAFreeVariantWithGoodOutcomes_WhenScouted_ThenItIsNeverProposed", () => {
    const free = {
      id: "openai/gpt-5:free",
      context_length: 400000,
      pricing: { prompt: "0", completion: "0" },
    };
    const paid = (LIST as { data: unknown[] }).data;

    const result = scoutProposal(
      { data: [...paid, free] },
      [tier("strong", "anthropic/claude-opus-4.1")],
      outcomes([
        ["anthropic/claude-opus-4.1", 20, 0.8],
        ["openai/gpt-5:free", 20, 0.95],
      ]),
    );

    expect(result).toMatchObject({ ok: true, proposal: null });
  });
});
