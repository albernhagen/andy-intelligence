import type { Hono } from "hono";
import {
  ConfigChange,
  TierKey,
  type ConfigChangeStore,
  type ModelOutcome,
  type RoutingConfigStore,
  type RunStore,
  type Tier,
  type WorkTracker,
} from "@andy/contracts";
import { scoutProposal, type UncheckedTier } from "@andy/domain";
import type { AuthEnv } from "./auth";
import type { RouteModule } from "./services";
import { invokerTokenVerifier, type InvokerTokenVerifier } from "./watchdog";

/**
 * Weekly model scout job (AI-268: M10.17, skills-and-scout.md §7.4). Cloud Scheduler calls
 * `MODEL_SCOUT_PATH` once a week with a Google OIDC token for its own service account. The job
 * fetches OpenRouter's public models list (no key, no spend), runs `scoutProposal` (AI-237:
 * M10.5) on the global tiers and the last 30 days of outcomes, and records at most one pending
 * ConfigChange (entity `tiers`) for Andy's Needs-you inbox. It never changes a tier.
 *
 * At most one proposal per ISO week: its dedupe key names the week, so a second call that week
 * finds it pending or decided and writes nothing. The list is untrusted data: fetched with a
 * timeout and a size cap, parsed and bounded by `parseModelList`, never logged.
 */

export const MODEL_SCOUT_PATH = "/jobs/model-scout";
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
/** One list fetch may take this long (ADR-0028). */
export const MODEL_LIST_TIMEOUT_MS = 15_000;
/** Largest models list read; past it the week is skipped. */
export const MODEL_LIST_MAX_BYTES = 5 * 1_048_576;
/** Outcomes are read over this many days. */
export const OUTCOME_WINDOW_DAYS = 30;
/** Ended runs read per project for outcomes. */
export const OUTCOME_RUNS_PER_PROJECT = 500;
/** Projects read for outcomes. */
export const OUTCOME_PROJECTS_MAX = 50;
/** Pending global changes allowed; the scout adds at most one a week. */
export const SCOUT_MAX_PENDING = 10;
/** Verified calls per instance per hour: the scheduler calls once a week (ADR-0028). */
export const MODEL_SCOUT_CALLS_PER_HOUR = 6;

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "model-scout", ...fields }));
}

export type ModelListFetch = { ok: true; data: unknown } | { ok: false; error: string };

/** The public models list, or why it couldn't be read. Never throws. */
export async function fetchModelList(
  fetchFn: typeof fetch = globalThis.fetch,
  url: string = OPENROUTER_MODELS_URL,
): Promise<ModelListFetch> {
  try {
    const res = await fetchFn(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return { ok: false, error: `the models list answered ${res.status}` };
    }
    const text = await readCapped(res, MODEL_LIST_MAX_BYTES);
    if (text === null) return { ok: false, error: "the models list is too large" };
    return { ok: true, data: JSON.parse(text) };
  } catch (err) {
    const name = (err as Error).name;
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, error: "the models list timed out" };
    }
    if (err instanceof SyntaxError) return { ok: false, error: "the models list is not JSON" };
    return { ok: false, error: "the models list request failed" };
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The ISO 8601 week of `at` (UTC), e.g. `2026-W47`. */
export function isoWeek(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // the week's Thursday decides its year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export const scoutDedupeKey = (week: string) => `model-scout:${week}`;

export type ScoutJobResult =
  | { outcome: "skipped"; week: string; reason: string }
  | { outcome: "no_change"; week: string; unchecked: UncheckedTier[] }
  | { outcome: "already_done"; week: string; changeId: string }
  | { outcome: "created"; week: string; changeId: string; unchecked: UncheckedTier[] }
  | { outcome: "capped"; week: string };

export interface ModelScoutDeps {
  tracker: Pick<WorkTracker, "listProjects">;
  runs: Pick<RunStore, "listEndedBetween">;
  routing: Pick<RoutingConfigStore, "getGlobal">;
  changes: Pick<ConfigChangeStore, "createPending" | "latestDecision" | "listPending">;
  fetchList?: () => Promise<ModelListFetch>;
  newId?: () => string;
  now?: () => Date;
}

export class ModelScoutJob {
  private readonly now: () => Date;

  constructor(private readonly deps: ModelScoutDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async run(): Promise<ScoutJobResult> {
    const at = this.now();
    const week = isoWeek(at);
    const key = scoutDedupeKey(week);
    const done = await this.thisWeeksChange(key);
    if (done) {
      log("INFO", "model scout already ran this week", { week, changeId: done });
      return { outcome: "already_done", week, changeId: done };
    }

    const list = await (this.deps.fetchList ?? (() => fetchModelList()))();
    if (!list.ok) {
      log("WARNING", "model scout skipped this week", { week, reason: list.error });
      return { outcome: "skipped", week, reason: list.error };
    }
    const global = await this.deps.routing.getGlobal();
    const tiers: Tier[] = TierKey.options
      .filter((k) => global.tiers[k].length > 0)
      .map((k) => ({ key: k, routes: global.tiers[k] }));
    // No model price store yet, so no known prices: `price_change` waits for one.
    const result = scoutProposal(list.data, tiers, await this.outcomes(at), []);
    if (!result.ok) {
      log("WARNING", "model scout skipped this week", { week, reason: result.error });
      return { outcome: "skipped", week, reason: result.error };
    }
    if (!result.proposal) {
      log("INFO", "model scout: no change", {
        week,
        skipped: result.skipped,
        unchecked: result.unchecked,
      });
      return { outcome: "no_change", week, unchecked: result.unchecked };
    }

    const { proposal } = result;
    const written = await this.deps.changes.createPending(
      ConfigChange.parse({
        id: (this.deps.newId ?? (() => crypto.randomUUID()))(),
        entity: proposal.entity,
        entityId: proposal.entityId,
        diff: proposal.diff,
        actor: "scout",
        reason: proposal.reason,
        status: "pending",
        createdAt: at.toISOString(),
        appliedAt: null,
        projectId: null,
        dedupeKey: key,
      }),
      SCOUT_MAX_PENDING,
    );
    if (written.outcome === "capped") {
      log("WARNING", "model scout: pending changes at their cap", { week, cap: SCOUT_MAX_PENDING });
      return { outcome: "capped", week };
    }
    if (written.outcome === "duplicate") {
      return { outcome: "already_done", week, changeId: written.change.id };
    }
    log("INFO", "model scout proposed a tier change", {
      week,
      changeId: written.change.id,
      tiers: proposal.changes.map((c) => `${c.tier}:${c.kind}`),
    });
    return { outcome: "created", week, changeId: written.change.id, unchecked: result.unchecked };
  }

  /** This week's scout change, pending or decided; null when it hasn't proposed one. */
  private async thisWeeksChange(key: string): Promise<string | null> {
    const pending = (await this.deps.changes.listPending()).find((c) => c.dedupeKey === key);
    if (pending) return pending.id;
    return (await this.deps.changes.latestDecision(key))?.id ?? null;
  }

  /** Finished agent tasks per model over the window: succeeded over succeeded plus failed. */
  private async outcomes(at: Date): Promise<Map<string, ModelOutcome>> {
    const from = new Date(at.getTime() - OUTCOME_WINDOW_DAYS * 86_400_000).toISOString();
    const projects = (await this.deps.tracker.listProjects()).slice(0, OUTCOME_PROJECTS_MAX);
    const counts = new Map<string, { tasks: number; ok: number }>();
    for (const p of projects) {
      const { runs, complete } = await this.deps.runs.listEndedBetween(
        p.id,
        from,
        at.toISOString(),
        OUTCOME_RUNS_PER_PROJECT,
      );
      if (!complete) log("WARNING", "model scout outcomes cut at the cap", { projectId: p.id });
      for (const r of runs) {
        if (r.status !== "succeeded" && r.status !== "failed") continue;
        const c = counts.get(r.route.model) ?? { tasks: 0, ok: 0 };
        c.tasks += 1;
        if (r.status === "succeeded") c.ok += 1;
        counts.set(r.route.model, c);
      }
    }
    return new Map(
      [...counts].map(([model, c]) => [model, { tasks: c.tasks, successRate: c.ok / c.tasks }]),
    );
  }
}

export interface ModelScoutRouteDeps {
  job: Pick<ModelScoutJob, "run">;
  verify: InvokerTokenVerifier;
  now?: () => Date;
}

export function registerModelScout(app: Hono<AuthEnv>, deps: ModelScoutRouteDeps): void {
  const now = deps.now ?? (() => new Date());
  let hour = "";
  let calls = 0;
  app.post(MODEL_SCOUT_PATH, async (c) => {
    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
    try {
      if (!match?.[1]) throw new Error("no bearer token");
      await deps.verify(match[1]);
    } catch {
      log("WARNING", "model scout token rejected");
      return c.json({ error: "unauthenticated" }, 401);
    }
    // After verification, so unauthenticated floods can't use up the cap.
    const thisHour = now().toISOString().slice(0, 13);
    if (thisHour !== hour) {
      hour = thisHour;
      calls = 0;
    }
    if (calls >= MODEL_SCOUT_CALLS_PER_HOUR) return c.json({ error: "rate limited" }, 429);
    calls += 1;
    try {
      const result = await deps.job.run();
      return c.json(result, 200);
    } catch (err) {
      log("ERROR", "model scout failed", { error: String(err) });
      return c.json({ error: "model scout failed" }, 500);
    }
  });
}

/**
 * Listed in `public-routes.ts`: Cloud Scheduler presents a Google OIDC token for the scout's
 * service account (audience = PUBLIC_URL). Absent unless `modelScout` is configured.
 */
export const publicRoutes: RouteModule = (app, s) => {
  const scout = s.deps.modelScout;
  const changes = s.deps.configChanges;
  const routing = s.deps.routing;
  if (!scout || !changes || !routing) return;
  registerModelScout(app, {
    job: new ModelScoutJob({
      tracker: s.deps.tracker,
      runs: s.deps.runs,
      routing,
      changes,
      now: s.now,
    }),
    verify: scout.verifyInvokerToken ?? invokerTokenVerifier(scout.publicUrl, scout.invokerEmail),
    now: s.now,
  });
};
