import {
  DEFAULT_ROUTING,
  DEFAULT_SPEND_CAPS,
  InMemoryModelGateway,
  InMemoryRoutingConfigStore,
  InMemoryRunStore,
  InMemorySpendLedger,
  MODEL_MAX_ATTEMPTS,
  type ModelGateway,
  type ModelMessage,
  type Route,
} from "@andy/contracts";
import {
  DomainError,
  NO_PRICES,
  SpendGate,
  reserveFor,
  type SpendCapsSource,
  type SpendPrices,
} from "@andy/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  DirectExecutor,
  affordableOutputTokens,
  inputTokenBound,
  parseAnswer,
  runUsageOf,
} from "./direct-executor";

/** AI-258: M10.11: Direct-call steps on the gateway. Fake gateway, ledger and stores only. */

const NOW = new Date("2026-11-21T12:00:00.000Z");
const DIRECT: Route = { harness: "direct", provider: "openrouter", model: "vendor/cheap" };
// $1 per million input tokens, $2 per million output tokens (= micro-USD per token).
const PRICED: SpendPrices = async () => ({ priceInPerMTokUsd: 1, priceOutPerMTokUsd: 2 });
const Ranking = z.object({ ranked: z.array(z.string()).min(1) });
const messages: ModelMessage[] = [
  { role: "system", content: "Rank the models." },
  { role: "user", content: "secret project text" },
];
const call = {
  projectId: "ai",
  ticketId: null,
  step: "scout" as const,
  messages,
  schema: Ranking,
  maxOutputTokens: 1_000,
};
const reply = (text: string, costUsd: number | null = 0.0004) => ({
  text,
  usage: { inputTokens: 120, outputTokens: 30, cachedTokens: 20, costUsd },
});

describe("DirectExecutor", () => {
  let runs: InMemoryRunStore;
  let ledger: InMemorySpendLedger;
  let routing: InMemoryRoutingConfigStore;
  let gateway: InMemoryModelGateway;

  const executor = (prices: SpendPrices = PRICED, caps?: SpendCapsSource) =>
    new DirectExecutor(
      runs,
      gateway,
      new SpendGate(ledger, prices, caps, () => NOW),
      prices,
      routing,
      () => NOW,
    );

  /** Global routing with `DIRECT` as the fast tier's only route and OpenRouter on. */
  async function routeFastToDirect() {
    await routing.put(
      {
        ...DEFAULT_ROUTING,
        providers: {
          ...DEFAULT_ROUTING.providers,
          openrouter: { ...DEFAULT_ROUTING.providers.openrouter, enabled: true },
        },
        tiers: { ...DEFAULT_ROUTING.tiers, fast: [DIRECT] },
      },
      null,
    );
  }

  beforeEach(() => {
    runs = new InMemoryRunStore();
    ledger = new InMemorySpendLedger();
    routing = new InMemoryRoutingConfigStore(() => NOW);
    gateway = new InMemoryModelGateway(reply('{"ranked":["a","b"]}'));
  });
  afterEach(() => vi.restoreAllMocks());

  it("GivenTheDefaultRouting_WhenAStepRuns_ThenNotDirectAndTheGatewayIsNeverCalled", async () => {
    const outcome = await executor().run(call);
    expect(outcome).toMatchObject({ kind: "not_direct", route: { harness: "claude-code" } });
    expect(gateway.calls).toHaveLength(0);
    expect(await runs.listActive("ai")).toHaveLength(0);
  });

  it("GivenADirectRoute_WhenTheAnswerFitsTheSchema_ThenReservesCallsSettlesAndReturnsIt", async () => {
    await routeFastToDirect();
    const outcome = await executor().run(call);
    expect(outcome.kind).toBe("done");
    if (outcome.kind !== "done") return;
    expect(outcome.output).toEqual({ ranked: ["a", "b"] });
    expect(outcome.run).toMatchObject({
      status: "succeeded",
      step: "scout",
      route: DIRECT,
      startedAt: NOW.toISOString(),
      costUsd: 0.0004,
      costIsEstimate: false,
      usage: { inputTokens: 100, cacheReadTokens: 20, outputTokens: 30, turns: 1 },
    });
    expect(gateway.calls[0]).toMatchObject({ model: DIRECT.model, maxOutputTokens: 1_000 });
    // Settled at usage × price: 100 + 20 input-priced cache reads at 1, 30 out at 2 = 180 micro-USD.
    expect(await ledger.get(outcome.run.id)).toMatchObject({
      state: "settled",
      settledMicroUsd: 180,
    });
  });

  it("GivenACapThatRefusesTheReservation_WhenAStepRuns_ThenTheRunFailsNamingTheCapAndNothingIsCalled", async () => {
    await routeFastToDirect();
    const caps: SpendCapsSource = async () => ({
      global: DEFAULT_SPEND_CAPS,
      project: { dailyMicroUsd: DEFAULT_SPEND_CAPS.perTaskMicroUsd - 1 },
    });
    const outcome = await executor(PRICED, caps).run(call);
    expect(outcome).toMatchObject({ kind: "failed", run: { status: "failed" } });
    if (outcome.kind !== "failed") return;
    expect(outcome.run.error).toContain("project_daily");
    expect(gateway.calls).toHaveLength(0);
    expect(await ledger.get(outcome.run.id)).toBeNull();
  });

  it("GivenNoPrice_WhenAStepRuns_ThenFailsClosedWithoutACall", async () => {
    await routeFastToDirect();
    const outcome = await executor(NO_PRICES).run(call);
    expect(outcome).toMatchObject({ kind: "failed" });
    if (outcome.kind !== "failed") return;
    expect(outcome.run.error).toContain("no price");
    expect(gateway.calls).toHaveLength(0);
  });

  it("GivenATinyPerTaskCap_WhenAStepRuns_ThenTheOutputCapFitsTwoAttemptsWithinIt", async () => {
    await routeFastToDirect();
    const perTask = 10_000;
    const caps: SpendCapsSource = async () => ({
      global: { ...DEFAULT_SPEND_CAPS, perTaskMicroUsd: perTask },
      project: null,
    });
    const pricey: SpendPrices = async () => ({ priceInPerMTokUsd: 3, priceOutPerMTokUsd: 15 });
    await executor(pricey, caps).run({ ...call, maxOutputTokens: 4_000 });
    const sent = gateway.calls[0]!.maxOutputTokens;
    expect(sent).toBeLessThan(4_000);
    const worst = reserveFor(
      { priceInPerMTokUsd: 3, priceOutPerMTokUsd: 15 },
      { kind: "call", inputTokens: inputTokenBound(messages), maxOutputTokens: sent },
    )!;
    expect(worst * MODEL_MAX_ATTEMPTS).toBeLessThanOrEqual(perTask);
  });

  it("GivenACapTooSmallForTheCall_WhenAStepRuns_ThenTheRunFailsAndTheReservationIsReleased", async () => {
    await routeFastToDirect();
    const caps: SpendCapsSource = async () => ({
      global: { ...DEFAULT_SPEND_CAPS, perTaskMicroUsd: 200 },
      project: null,
    });
    const outcome = await executor(PRICED, caps).run(call);
    expect(outcome).toMatchObject({ kind: "failed" });
    if (outcome.kind !== "failed") return;
    expect(outcome.run.error).toContain("per-task cap affords");
    expect(gateway.calls).toHaveLength(0);
    expect(await ledger.get(outcome.run.id)).toMatchObject({ state: "released" });
  });

  it("GivenAnAnswerThatFailsTheSchema_WhenAStepRuns_ThenFailsWithTheValidationErrorAndSettlesItsCost", async () => {
    await routeFastToDirect();
    gateway.answer = reply('{"ranked":[]}');
    const outcome = await executor().run(call);
    expect(outcome).toMatchObject({ kind: "failed" });
    if (outcome.kind !== "failed") return;
    expect(outcome.run.error).toContain("fails the step's schema: ranked: too_small");
    expect(outcome.run.costUsd).toBe(0.0004);
    expect(await ledger.get(outcome.run.id)).toMatchObject({
      state: "settled",
      settledMicroUsd: 180,
    });
  });

  it("GivenAGatewayError_WhenAStepRuns_ThenFailsAndKeepsTheFullReservation", async () => {
    await routeFastToDirect();
    gateway.answer = { status: 502 };
    const outcome = await executor().run(call);
    expect(outcome).toMatchObject({ kind: "failed" });
    if (outcome.kind !== "failed") return;
    expect(outcome.run.error).toContain("provider answered 502");
    const entry = await ledger.get(outcome.run.id);
    expect(entry).toMatchObject({ state: "settled" });
    expect(entry!.settledMicroUsd).toBe(entry!.reservedMicroUsd);
  });

  it("GivenNoGatewayKey_WhenAStepRuns_ThenFailsAndReleasesTheReservation", async () => {
    await routeFastToDirect();
    gateway.enabled = false;
    const outcome = await executor().run(call);
    expect(outcome).toMatchObject({ kind: "failed", reason: expect.stringContaining("no key") });
    if (outcome.kind !== "failed") return;
    expect(outcome.run.startedAt).toBeNull();
    expect(await ledger.get(outcome.run.id)).toMatchObject({ state: "released" });
  });

  it.each(["refine", "plan", "build", "sync", "review", "verify"] as const)(
    "GivenTheNonSingleCallStep%s_WhenRunDirect_ThenRefusedBeforeAnything",
    async (step) => {
      await routeFastToDirect();
      await expect(executor().run({ ...call, step })).rejects.toBeInstanceOf(DomainError);
      expect(gateway.calls).toHaveLength(0);
      expect(await runs.listActive("ai")).toHaveLength(0);
    },
  );

  it("GivenAnEnumSchemaAndASecretBearingAnswer_WhenItFails_ThenTheAnswerIsNeitherStoredNorLogged", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
    await routeFastToDirect();
    gateway.answer = reply('{"pick":"leaked-secret-value"}');
    const outcome = await executor().run({
      ...call,
      schema: z.object({ pick: z.enum(["a", "b"]) }),
    });
    expect(outcome).toMatchObject({ kind: "failed" });
    if (outcome.kind !== "failed") return;
    expect(outcome.run.error).toContain("pick: invalid_value");
    expect(outcome.run.error).not.toContain("leaked-secret-value");
    expect(logs.join("\n")).not.toContain("leaked-secret-value");
  });

  it("GivenARetriedCall_WhenItAnswers_ThenTheFullReservationIsKept", async () => {
    await routeFastToDirect();
    const retried: ModelGateway = {
      complete: async () => ({ ...reply('{"ranked":["a"]}'), outcome: "ok", attempts: 2 }),
    };
    const outcome = await new DirectExecutor(
      runs,
      retried,
      new SpendGate(ledger, PRICED, undefined, () => NOW),
      PRICED,
      routing,
      () => NOW,
    ).run(call);
    expect(outcome.kind).toBe("done");
    if (outcome.kind !== "done") return;
    expect(outcome.run.usage).toMatchObject({ outputTokens: 30 });
    const entry = await ledger.get(outcome.run.id);
    expect(entry!.settledMicroUsd).toBe(entry!.reservedMicroUsd);
  });

  it("GivenTheRunStoreFailsBeforeTheCall_WhenAStepRuns_ThenFailedAndReleasedWithoutACall", async () => {
    await routeFastToDirect();
    const update = runs.update.bind(runs);
    vi.spyOn(runs, "update")
      .mockRejectedValueOnce(new Error("store down"))
      .mockImplementation((...args) => update(...args));
    const outcome = await executor().run(call);
    expect(outcome).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("store down"),
    });
    if (outcome.kind !== "failed") return;
    expect(gateway.calls).toHaveLength(0);
    expect(outcome.run.status).toBe("failed");
    expect(await ledger.get(outcome.run.id)).toMatchObject({ state: "released" });
  });

  it("GivenTheGatewayThrows_WhenAStepRuns_ThenFailedAndTheFullReservationIsKept", async () => {
    await routeFastToDirect();
    const broken: ModelGateway = {
      complete: async () => {
        throw new Error("socket hang up");
      },
    };
    const outcome = await new DirectExecutor(
      runs,
      broken,
      new SpendGate(ledger, PRICED, undefined, () => NOW),
      PRICED,
      routing,
      () => NOW,
    ).run(call);
    expect(outcome).toMatchObject({ kind: "failed", run: { status: "failed" } });
    if (outcome.kind !== "failed") return;
    const entry = await ledger.get(outcome.run.id);
    expect(entry).toMatchObject({ state: "settled" });
    expect(entry!.settledMicroUsd).toBe(entry!.reservedMicroUsd);
  });

  it("GivenTheSucceededWriteFails_WhenAStepRuns_ThenFailedAndSettledAtItsUsage", async () => {
    await routeFastToDirect();
    const update = runs.update.bind(runs);
    let calls = 0;
    vi.spyOn(runs, "update").mockImplementation((id, patch, from) => {
      calls++;
      if (calls === 2) return Promise.reject(new Error("write lost"));
      return update(id, patch, from);
    });
    const outcome = await executor().run(call);
    expect(outcome).toMatchObject({ kind: "failed", run: { status: "failed" } });
    if (outcome.kind !== "failed") return;
    expect(await ledger.get(outcome.run.id)).toMatchObject({
      state: "settled",
      settledMicroUsd: 180,
    });
  });

  it("GivenAnyOutcome_WhenLogged_ThenNeitherThePromptNorTheAnswerAppears", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
    await routeFastToDirect();
    gateway.answer = reply('{"ranked":["model-reply-x"]}');
    await executor().run(call);
    gateway.answer = reply('{"wrong":"model-reply-y"}');
    await executor().run(call);
    const all = logs.join("\n");
    for (const secret of ["secret project text", "model-reply-x", "model-reply-y"]) {
      expect(all).not.toContain(secret);
    }
  });
});

describe("affordableOutputTokens", () => {
  const model = { priceInPerMTokUsd: 3, priceOutPerMTokUsd: 15 };

  it("GivenAmpleBudget_WhenSized_ThenTheCeiling", () => {
    expect(affordableOutputTokens(model, 1_000, 2_000_000, 4_000)).toBe(4_000);
  });

  it("GivenATightBudget_WhenSized_ThenTheLargestCapThatFitsEveryAttempt", () => {
    const budget = 50_000;
    const n = affordableOutputTokens(model, 1_000, budget, 32_000);
    const cost = (out: number) =>
      reserveFor(model, { kind: "call", inputTokens: 1_000, maxOutputTokens: out })!;
    expect(cost(n) * MODEL_MAX_ATTEMPTS).toBeLessThanOrEqual(budget);
    expect(cost(n + 1)).toBeGreaterThan(Math.floor(budget / MODEL_MAX_ATTEMPTS));
  });

  it("GivenInputAloneOverBudget_WhenSized_ThenZero", () => {
    expect(affordableOutputTokens(model, 1_000_000, 1_000, 4_000)).toBe(0);
  });

  it("GivenNoPrice_WhenSized_ThenZero", () => {
    expect(
      affordableOutputTokens({ priceInPerMTokUsd: null, priceOutPerMTokUsd: 1 }, 10, 1e9, 100),
    ).toBe(0);
  });
});

describe("parseAnswer and usage", () => {
  it("GivenAFencedJsonAnswer_WhenParsed_ThenTheValue", () => {
    expect(parseAnswer('```json\n{"ranked":["a"]}\n```', Ranking)).toEqual({
      ok: true,
      value: { ranked: ["a"] },
    });
  });

  it("GivenProse_WhenParsed_ThenNotJson", () => {
    expect(parseAnswer("Sure! Here you go.", Ranking)).toEqual({
      ok: false,
      reason: "the answer is not JSON",
    });
  });

  it("GivenGatewayUsage_WhenConverted_ThenCachedTokensMoveOutOfInput", () => {
    expect(
      runUsageOf({ inputTokens: 100, outputTokens: 5, cachedTokens: 40, costUsd: null }, 7),
    ).toEqual({
      inputTokens: 60,
      outputTokens: 5,
      cacheReadTokens: 40,
      cacheWriteTokens: 0,
      turns: 1,
      wallMs: 7,
    });
  });
});
