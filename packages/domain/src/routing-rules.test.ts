import { HarnessKey, ProviderKey, type Route } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { HARNESS_PROVIDERS, ROUTE_MODEL_MAX, isClaudeModel, routeProblem } from "./routing-rules";
import { TIER_ROUTES } from "./tiers";

/** A model each harness accepts, so a pair test checks only harness ↔ provider. */
const MODEL_FOR: Record<HarnessKey, string> = {
  "claude-code": "sonnet",
  jules: "gemini-2.5-pro",
  opencode: "deepseek/deepseek-chat",
  direct: "openai/gpt-5",
};

const pairs = HarnessKey.options.flatMap((harness) =>
  ProviderKey.options.map((provider) => ({ harness, provider })),
);

describe("routeProblem: harness and provider", () => {
  // 4 harnesses × 4 providers. A new harness or provider fails here: give it a rule and a model.
  it("GivenEveryHarnessAndProvider_WhenListed_ThenTheTableCoversAllSixteenPairs", () => {
    expect(pairs).toHaveLength(16);
  });

  it("GivenClaudeCode_WhenCheckedOnTheApiKeyProvider_ThenItPasses", () => {
    expect(
      routeProblem({ harness: "claude-code", provider: "claude-api", model: "opus" }),
    ).toBeNull();
  });

  it.each(pairs)(
    "GivenHarness$harnessOnProvider$provider_WhenChecked_ThenOnlyItsOwnProvidersPass",
    ({ harness, provider }) => {
      const problem = routeProblem({ harness, provider, model: MODEL_FOR[harness] });
      if (HARNESS_PROVIDERS[harness].includes(provider)) {
        expect(problem).toBeNull();
      } else {
        expect(problem).toContain(harness);
        expect(problem).toContain(provider);
      }
    },
  );
});

describe("routeProblem: model", () => {
  const claudeCode = (model: string): Route => ({
    harness: "claude-code",
    provider: "claude-sub",
    model,
  });

  it.each(["gpt-5", "gemini-2.5-pro", "anthropic/claude-opus"])(
    "GivenClaudeCodeWithNonClaudeModel%s_WhenChecked_ThenItIsRefusedNamingTheModel",
    (model) => {
      expect(routeProblem(claudeCode(model))).toBe(
        `harness claude-code takes only Claude models, not ${model}`,
      );
    },
  );

  it.each(["opus", "sonnet", "haiku", "sonnet[1m]", "claude-opus-5-5", "Claude-Sonnet-5-5"])(
    "GivenClaudeCodeWithClaudeModel%s_WhenChecked_ThenNull",
    (model) => {
      expect(routeProblem(claudeCode(model))).toBeNull();
    },
  );

  it.each([
    ["empty", "", "the model id is empty"],
    ["blank", "   ", "the model id is empty"],
    [
      "too long",
      "x".repeat(ROUTE_MODEL_MAX + 1),
      `the model id is ${ROUTE_MODEL_MAX + 1} characters (at most ${ROUTE_MODEL_MAX})`,
    ],
  ])("GivenA%sModelId_WhenChecked_ThenRefused", (_, model, reason) => {
    expect(routeProblem({ harness: "direct", provider: "openrouter", model })).toBe(reason);
  });

  it("GivenAModelIdAtTheLimit_WhenChecked_ThenNull", () => {
    const model = "x".repeat(ROUTE_MODEL_MAX);
    expect(routeProblem({ harness: "opencode", provider: "openrouter", model })).toBeNull();
  });

  it("GivenOpenRouterHarnesses_WhenAnyModelIsNamed_ThenNull", () => {
    expect(routeProblem({ harness: "direct", provider: "openrouter", model: "opus" })).toBeNull();
    expect(
      routeProblem({ harness: "opencode", provider: "openrouter", model: "claude-opus-5-5" }),
    ).toBeNull();
  });

  it("GivenTodaysTierRoutes_WhenChecked_ThenEachIsCompatible", () => {
    expect(Object.values(TIER_ROUTES).map(routeProblem)).toEqual([null, null]);
  });
});

describe("isClaudeModel", () => {
  it.each([
    ["opusplan", true],
    ["claude-haiku-5-5", true],
    ["sonnet-ish", false],
    ["opus[1m]", true],
    ["[".repeat(50_000) + "]", false],
    ["gpt-5", false],
  ])("GivenModel%s_WhenChecked_Then%s", (model, expected) => {
    expect(isClaudeModel(model)).toBe(expected);
  });
});
