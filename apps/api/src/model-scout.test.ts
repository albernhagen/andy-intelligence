import { Hono } from "hono";
import {
  DEFAULT_ROUTING,
  InMemoryConfigChangeStore,
  InMemoryRoutingConfigStore,
  type Project,
  type Route,
  type Run,
} from "@andy/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthEnv } from "./auth";
import {
  MODEL_LIST_MAX_BYTES,
  MODEL_SCOUT_CALLS_PER_HOUR,
  MODEL_SCOUT_PATH,
  ModelScoutJob,
  fetchModelList,
  isoWeek,
  registerModelScout,
  scoutDedupeKey,
  type ModelListFetch,
} from "./model-scout";

/** AI-268: M10.17: Weekly model scout job. Fakes and a mocked list only: no network, no spend. */

const NOW = new Date("2026-11-21T12:00:00.000Z"); // a Saturday in 2026-W47
const OLD: Route = { harness: "opencode", provider: "openrouter", model: "vendor/old" };
const listed = (id: string, prompt: string, completion: string) => ({
  id,
  name: id,
  context_length: 200_000,
  pricing: { prompt, completion },
});
// vendor/new costs a tenth of vendor/old per token.
const LIST = {
  data: [listed("vendor/old", "0.00001", "0.00003"), listed("vendor/new", "0.000001", "0.000003")],
};

/** Six finished tasks for each model, all succeeded. */
function endedRuns(): Run[] {
  return ["vendor/old", "vendor/new"].flatMap((model) =>
    Array.from({ length: 6 }, (_, i) => ({
      id: `${model}-${i}`,
      status: "succeeded",
      route: { ...OLD, model },
    })),
  ) as unknown as Run[];
}

describe("ModelScoutJob", () => {
  let changes: InMemoryConfigChangeStore;
  let routing: InMemoryRoutingConfigStore;
  let ids: number;

  const job = (list: ModelListFetch = { ok: true, data: LIST }, runs: Run[] = endedRuns()) =>
    new ModelScoutJob({
      tracker: { listProjects: async () => [{ id: "ai" } as Project] },
      runs: { listEndedBetween: async () => ({ runs, complete: true }) },
      routing,
      changes,
      fetchList: async () => list,
      newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
      now: () => NOW,
    });

  /** Global routing whose fast tier's first route is `OLD`. */
  async function scoutableFastTier() {
    await routing.put(
      { ...DEFAULT_ROUTING, tiers: { ...DEFAULT_ROUTING.tiers, fast: [OLD] } },
      null,
    );
  }

  beforeEach(() => {
    changes = new InMemoryConfigChangeStore();
    routing = new InMemoryRoutingConfigStore(() => NOW);
    ids = 0;
  });

  it("GivenACheaperQualifyingModel_WhenTheJobRuns_ThenOnePendingTierChangeAndNoTierChanges", async () => {
    await scoutableFastTier();
    const result = await job().run();
    expect(result).toMatchObject({ outcome: "created", week: "2026-W47" });
    const pending = await changes.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      entity: "tiers",
      entityId: "global",
      actor: "scout",
      status: "pending",
      projectId: null,
      dedupeKey: scoutDedupeKey("2026-W47"),
      diff: { fast: { kind: "cheaper", from: "vendor/old", to: "vendor/new" } },
    });
    expect((await routing.getGlobal()).tiers.fast).toEqual([OLD]);
  });

  it("GivenTheDefaultRouting_WhenTheJobRuns_ThenNoChange", async () => {
    // Every default tier is on claude-sub: the list prices only openrouter routes.
    expect(await job().run()).toMatchObject({ outcome: "no_change" });
    expect(await changes.listPending()).toHaveLength(0);
  });

  it("GivenTooFewOutcomes_WhenTheJobRuns_ThenNoChange", async () => {
    await scoutableFastTier();
    expect(await job(undefined, endedRuns().slice(0, 3)).run()).toMatchObject({
      outcome: "no_change",
    });
  });

  it("GivenTheListCantBeFetched_WhenTheJobRuns_ThenTheWeekIsSkippedAndLogged", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
    await scoutableFastTier();
    const result = await job({ ok: false, error: "the models list timed out" }).run();
    expect(result).toEqual({
      outcome: "skipped",
      week: "2026-W47",
      reason: "the models list timed out",
    });
    expect(logs.join("\n")).toContain("model scout skipped this week");
    expect(await changes.listPending()).toHaveLength(0);
  });

  it("GivenAListThatDoesNotParse_WhenTheJobRuns_ThenSkipped", async () => {
    await scoutableFastTier();
    expect(await job({ ok: true, data: { models: [] } }).run()).toMatchObject({
      outcome: "skipped",
    });
  });

  it("GivenThisWeeksChangeIsPending_WhenTheJobRunsAgain_ThenNothingNewIsWrittenAndTheListIsNotFetched", async () => {
    await scoutableFastTier();
    const first = await job().run();
    const fetchList = vi.fn(async (): Promise<ModelListFetch> => ({ ok: true, data: LIST }));
    const again = new ModelScoutJob({
      tracker: { listProjects: async () => [] },
      runs: { listEndedBetween: async () => ({ runs: [], complete: true }) },
      routing,
      changes,
      fetchList,
      now: () => NOW,
    });
    const second = await again.run();
    expect(second).toEqual({
      outcome: "already_done",
      week: "2026-W47",
      changeId: (first as { changeId: string }).changeId,
    });
    expect(fetchList).not.toHaveBeenCalled();
    expect(await changes.listPending()).toHaveLength(1);
  });

  it("GivenThisWeeksChangeWasRejected_WhenTheJobRunsAgain_ThenItIsNotProposedAgain", async () => {
    await scoutableFastTier();
    const first = (await job().run()) as { changeId: string };
    await changes.decide(first.changeId, "rejected", "user:andy", NOW.toISOString());
    expect(await job().run()).toMatchObject({ outcome: "already_done", changeId: first.changeId });
    expect(await changes.listPending()).toHaveLength(0);
  });
});

describe("fetchModelList", () => {
  const ok = (body: string, status = 200) =>
    vi.fn<typeof fetch>(async () => new Response(body, { status }));

  it("GivenAJsonList_WhenFetched_ThenItsDataWithNoKeyAndNoRedirects", async () => {
    const f = ok(JSON.stringify(LIST));
    expect(await fetchModelList(f)).toEqual({ ok: true, data: LIST });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/models");
    expect(init?.redirect).toBe("error");
    expect(JSON.stringify(init?.headers)).not.toMatch(/authorization/i);
  });

  it.each([
    ["a 503", ok("down", 503), "the models list answered 503"],
    ["not JSON", ok("<html>"), "the models list is not JSON"],
    ["too large", ok("x".repeat(MODEL_LIST_MAX_BYTES + 1)), "the models list is too large"],
    [
      "a network failure",
      vi.fn<typeof fetch>(() => Promise.reject(new TypeError("fetch failed"))),
      "the models list request failed",
    ],
  ])("GivenTheListAnswers%s_WhenFetched_ThenAnError", async (_, f, error) => {
    expect(await fetchModelList(f)).toEqual({ ok: false, error });
  });

  it("GivenAListThatNeverAnswers_WhenFetched_ThenItTimesOut", async () => {
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(
      AbortSignal.abort(new DOMException("t", "TimeoutError")),
    );
    const f = vi.fn<typeof fetch>((_, init) => Promise.reject(init?.signal?.reason));
    expect(await fetchModelList(f)).toEqual({ ok: false, error: "the models list timed out" });
  });
});

describe("isoWeek", () => {
  it.each([
    ["2026-11-21T12:00:00Z", "2026-W47"],
    ["2026-11-16T00:00:00Z", "2026-W47"],
    ["2027-01-01T00:00:00Z", "2026-W53"],
    ["2025-12-29T00:00:00Z", "2026-W01"],
  ])("GivenTheDate%s_WhenWeekIsTaken_Then%s", (at, week) => {
    expect(isoWeek(new Date(at))).toBe(week);
  });
});

describe("model scout route", () => {
  afterEach(() => vi.restoreAllMocks());

  function app(
    verify = async (jwt: string) => {
      if (jwt !== "good") throw new Error("bad");
    },
  ) {
    const run = vi.fn(async () => ({
      outcome: "no_change" as const,
      week: "2026-W47",
      unchecked: [],
    }));
    const hono = new Hono<AuthEnv>();
    registerModelScout(hono, { job: { run }, verify, now: () => NOW });
    const call = (auth?: string) =>
      hono.request(MODEL_SCOUT_PATH, {
        method: "POST",
        headers: auth ? { authorization: auth } : {},
      });
    return { run, call };
  }

  it("GivenTheSchedulersToken_WhenCalled_ThenTheJobRuns", async () => {
    const { run, call } = app();
    const res = await call("Bearer good");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "no_change" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "Bearer bad", "Basic good"])(
    "GivenTheAuthorization%s_WhenCalled_Then401AndNoRun",
    async (auth) => {
      const { run, call } = app();
      expect((await call(auth)).status).toBe(401);
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("GivenTooManyCallsInAnHour_WhenCalledAgain_Then429", async () => {
    const { run, call } = app();
    for (let i = 0; i < MODEL_SCOUT_CALLS_PER_HOUR; i++) await call("Bearer good");
    expect((await call("Bearer good")).status).toBe(429);
    expect(run).toHaveBeenCalledTimes(MODEL_SCOUT_CALLS_PER_HOUR);
  });
});
