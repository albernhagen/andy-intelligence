import type { ModelRequest } from "@andy/contracts";
import { modelGatewayContract } from "@andy/contracts/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPENROUTER_MAX_RESPONSE_BYTES,
  OPENROUTER_URL,
  OpenRouterGateway,
  type OpenRouterConfig,
} from "./openrouter";

// Every test mocks `fetch`: no key, no network call and no spend (AI-250: M10.10).

const KEY = "sk-or-test-not-a-real-key";

/** An OpenRouter chat-completion body. */
function bodyFor(
  text: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    costUsd: number | null;
  } | null,
) {
  return JSON.stringify({
    id: "gen-1",
    choices: [{ message: { role: "assistant", content: text } }],
    ...(usage && {
      usage: {
        prompt_tokens: usage.inputTokens,
        completion_tokens: usage.outputTokens,
        prompt_tokens_details: { cached_tokens: usage.cachedTokens },
        ...(usage.costUsd !== null && { cost: usage.costUsd }),
      },
    }),
  });
}

/** A mocked `fetch` that answers each call with the next of `responses` (the last repeats). */
function mockFetch(...responses: (() => Response | Promise<Response>)[]) {
  return vi.fn<typeof fetch>(async () => {
    const next = responses.length > 1 ? responses.shift()! : responses[0]!;
    return next();
  });
}

const json = (status: number, body: string) => () =>
  new Response(body, { status, headers: { "Content-Type": "application/json" } });

const gateway = (f: typeof fetch, over: Partial<OpenRouterConfig> = {}) =>
  new OpenRouterGateway({ readKey: async () => KEY, fetch: f, ...over });

const request: ModelRequest = {
  model: "test/model",
  messages: [
    { role: "system", content: "Be brief." },
    { role: "user", content: "secret project text" },
  ],
  maxOutputTokens: 256,
};

afterEach(() => vi.restoreAllMocks());

modelGatewayContract("OpenRouter against a mocked fetch", async (answer) => {
  const f =
    answer === null || !("status" in answer)
      ? mockFetch(json(200, bodyFor(answer?.text ?? "", answer?.usage ?? null)))
      : mockFetch(json(answer.status, '{"error":{"message":"no"}}'));
  const g = answer === null ? gateway(f, { readKey: async () => null }) : gateway(f);
  return { gateway: g, delivered: () => f.mock.calls.length };
});

describe("OpenRouterGateway", () => {
  it("GivenARequest_WhenCompleted_ThenPostsMaxTokensAndTheKeyWithNoRedirects", async () => {
    const f = mockFetch(json(200, bodyFor("ok", null)));
    await gateway(f).complete(request);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(OPENROUTER_URL);
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init?.body as string)).toEqual({
      model: "test/model",
      messages: request.messages,
      max_tokens: 256,
      usage: { include: true },
    });
  });

  it("GivenABlankKey_WhenCompleted_ThenOffAndNothingIsSent", async () => {
    const f = mockFetch(json(200, bodyFor("ok", null)));
    expect(await gateway(f, { readKey: async () => "  " }).complete(request)).toEqual({
      outcome: "off",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("GivenTheKeyCannotBeRead_WhenCompleted_ThenErrorAndNothingIsSent", async () => {
    const f = mockFetch(json(200, bodyFor("ok", null)));
    const g = gateway(f, {
      readKey: async () => {
        throw new Error("permission denied");
      },
    });
    expect(await g.complete(request)).toEqual({
      outcome: "error",
      status: null,
      reason: "cannot read key",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("GivenTheKeyChanges_WhenCompletedTwice_ThenEachCallReadsItAgain", async () => {
    const readKey = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce("k1")
      .mockResolvedValueOnce("k2");
    const f = mockFetch(json(200, bodyFor("ok", null)));
    const g = gateway(f, { readKey });
    await g.complete(request);
    await g.complete(request);
    const auth = f.mock.calls.map(
      ([, init]) => (init?.headers as Record<string, string>).Authorization,
    );
    expect(auth).toEqual(["Bearer k1", "Bearer k2"]);
  });

  it("GivenA5xxThenSuccess_WhenCompleted_ThenRetriesOnceAndReturnsTheReply", async () => {
    const f = mockFetch(json(502, "bad gateway"), json(200, bodyFor("ok", null)));
    expect(await gateway(f).complete(request)).toMatchObject({ outcome: "ok", text: "ok" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("GivenTwo5xx_WhenCompleted_ThenErrorAfterTwoCalls", async () => {
    const f = mockFetch(json(503, ""));
    expect(await gateway(f).complete(request)).toEqual({
      outcome: "error",
      status: 503,
      reason: "provider answered 503",
    });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("GivenANetworkFailure_WhenCompleted_ThenErrorWithoutRetry", async () => {
    const f = mockFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await gateway(f).complete(request)).toEqual({
      outcome: "error",
      status: null,
      reason: "request failed",
    });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("GivenAProviderThatNeverAnswers_WhenCompleted_ThenStopsWaitingAtTheTimeout", async () => {
    const f = vi.fn<typeof fetch>(
      (_, init) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
        ),
    );
    const started = Date.now();
    const result = await gateway(f).complete({ ...request, timeoutMs: 50 });
    expect(result).toEqual({ outcome: "error", status: null, reason: "timed out" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("GivenATimeoutOverTheCap_WhenCompleted_ThenTheSignalUsesTheCap", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const f = mockFetch(json(200, bodyFor("ok", null)));
    await gateway(f).complete({ ...request, timeoutMs: 10 * 60_000 });
    expect(timeout).toHaveBeenCalledWith(60_000);
  });

  it("GivenAResponseOverTheSizeCap_WhenCompleted_ThenError", async () => {
    const f = mockFetch(json(200, "x".repeat(OPENROUTER_MAX_RESPONSE_BYTES + 1)));
    expect(await gateway(f).complete(request)).toEqual({
      outcome: "error",
      status: null,
      reason: "response too large",
    });
  });

  it.each([
    ["not JSON", "<html>oops</html>"],
    ["no choices", '{"choices":[]}'],
    [
      "a negative token count",
      '{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":-1,"completion_tokens":1}}',
    ],
  ])("GivenAResponseWith%s_WhenCompleted_ThenUnreadableError", async (_, body) => {
    const f = mockFetch(json(200, body));
    expect(await gateway(f).complete(request)).toEqual({
      outcome: "error",
      status: 200,
      reason: "unreadable response",
    });
  });

  it.each([
    ["null content", '{"choices":[{"message":{"content":null}}]}', "empty response"],
    ["empty content", '{"choices":[{"message":{"content":""}}]}', "empty response"],
    [
      "an error field",
      '{"error":{"code":502,"message":"upstream"},"choices":[{"message":{"content":"partial"}}]}',
      "provider error",
    ],
  ])("GivenA200With%s_WhenCompleted_ThenError", async (_, body, reason) => {
    const f = mockFetch(json(200, body));
    expect(await gateway(f).complete(request)).toEqual({ outcome: "error", status: 200, reason });
  });

  it("GivenUsageWithoutCost_WhenCompleted_ThenCostIsNull", async () => {
    const f = mockFetch(
      json(200, bodyFor("ok", { inputTokens: 5, outputTokens: 1, cachedTokens: 0, costUsd: null })),
    );
    expect(await gateway(f).complete(request)).toEqual({
      outcome: "ok",
      text: "ok",
      usage: { inputTokens: 5, outputTokens: 1, cachedTokens: 0, costUsd: null },
    });
  });

  it("GivenAnyOutcome_WhenLogged_ThenNeitherTheKeyNorTheMessagesNorTheProviderBodyAppear", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
    const g = gateway(mockFetch(json(200, bodyFor("model reply", null))));
    await g.complete(request);
    await gateway(mockFetch(json(401, '{"error":"echo secret project text"}'))).complete(request);
    await gateway(mockFetch(json(503, ""))).complete(request);
    const all = logs.join("\n");
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of [KEY, "secret project text", "model reply", "Be brief"]) {
      expect(all).not.toContain(secret);
    }
  });
});
