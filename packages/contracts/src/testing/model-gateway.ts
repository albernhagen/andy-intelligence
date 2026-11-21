import { describe, expect, it } from "vitest";
import type { FakeModelAnswer } from "../fakes/model-gateway";
import type { ModelGateway, ModelRequest } from "../ports/model-gateway";

/** A gateway whose provider gives `answer` (null: no key configured), and how many calls reached it. */
export interface ModelGatewayHarness {
  gateway: ModelGateway;
  delivered: () => number;
}

export function modelGatewayContract(
  name: string,
  make: (answer: FakeModelAnswer | null) => Promise<ModelGatewayHarness>,
): void {
  describe(`ModelGateway contract: ${name}`, () => {
    const request: ModelRequest = {
      model: "test/model",
      messages: [{ role: "user", content: "Say ok." }],
      maxOutputTokens: 16,
    };
    const usage = { inputTokens: 12, outputTokens: 3, cachedTokens: 4, costUsd: 0.00042 };

    it("GivenTheProviderAnswers_WhenCompleted_ThenTextAndUsage", async () => {
      const h = await make({ text: "ok", usage });
      expect(await h.gateway.complete(request)).toEqual({
        outcome: "ok",
        text: "ok",
        usage,
        attempts: 1,
      });
      expect(h.delivered()).toBe(1);
    });

    it("GivenTheProviderReportsNoUsage_WhenCompleted_ThenUsageIsNull", async () => {
      const h = await make({ text: "ok", usage: null });
      expect(await h.gateway.complete(request)).toEqual({
        outcome: "ok",
        text: "ok",
        usage: null,
        attempts: 1,
      });
    });

    it.each([400, 401, 402, 429])(
      "GivenTheProviderAnswers%i_WhenCompleted_ThenErrorAfterOneCall",
      async (status) => {
        const h = await make({ status });
        expect(await h.gateway.complete(request)).toMatchObject({ outcome: "error", status });
        expect(h.delivered()).toBe(1);
      },
    );

    it("GivenNoKey_WhenCompleted_ThenOffAndNothingIsSent", async () => {
      const h = await make(null);
      expect(await h.gateway.complete(request)).toEqual({ outcome: "off" });
      expect(h.delivered()).toBe(0);
    });

    it.each([
      ["no output cap", { ...request, maxOutputTokens: 0 }],
      ["an output cap over the maximum", { ...request, maxOutputTokens: 1_000_000 }],
      ["no messages", { ...request, messages: [] }],
      ["no model", { ...request, model: " " }],
    ])("GivenARequestWith%s_WhenCompleted_ThenErrorAndNothingIsSent", async (_, bad) => {
      const h = await make({ text: "ok", usage });
      expect(await h.gateway.complete(bad)).toMatchObject({ outcome: "error", status: null });
      expect(h.delivered()).toBe(0);
    });
  });
}
