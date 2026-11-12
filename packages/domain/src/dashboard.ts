import {
  ACTIVE_RUN_STATUSES,
  DASHBOARD_DEFAULT_WEEKS,
  DASHBOARD_EXPENSIVE_RUNS,
  DASHBOARD_MAX_WEEKS,
  DashboardSize,
  RunStep,
  Stage,
  notFound,
  type Dashboard,
  type DashboardCost,
  type DashboardFigure,
  type DashboardRun,
  type DashboardWeek,
  type Project,
  type ProjectDashboard,
  type Run,
  type RunStore,
  type Ticket,
  type TicketEvent,
  type WorkTracker,
} from "@andy/contracts";

/**
 * Dashboards data (AI-102, ADR-0045, ADR-0020): delivery and cost per week, computed on read
 * from stored tickets, ticket events and runs; nothing is stored. `dashboardFigures` is pure;
 * `DashboardReader` gathers its data under the caps below and says which figures they truncated.
 */

/**
 * Ended runs one project's dashboard reads (ADR-0028), newest first. The run store counts other
 * projects' runs toward it, so the all-projects read costs up to this many reads per project.
 */
export const MAX_DASHBOARD_RUNS = 500;
/** Ticket histories one project's dashboard reads (ADR-0028); the most recently changed first. */
export const MAX_DASHBOARD_TICKET_READS = 200;
/** Projects the all-projects dashboard covers (ADR-0028), by key. */
export const MAX_DASHBOARD_PROJECTS = 20;

const WEEK_MS = 7 * 24 * 3_600_000;
const HOUR_MS = 3_600_000;

export interface DashboardWindow {
  /** Monday 00:00 UTC of the first week. */
  from: Date;
  to: Date;
  weeks: number;
}

/** The run fields the figures use; the rest (prompt, summary, plan) is dropped after the read. */
export type DashboardRunInput = Pick<
  Run,
  | "id"
  | "projectId"
  | "ticketId"
  | "step"
  | "status"
  | "endedAt"
  | "costUsd"
  | "costIsEstimate"
  | "usage"
  | "quotaDelta"
  | "metrics"
>;

const slim = (r: Run): DashboardRunInput => ({
  id: r.id,
  projectId: r.projectId,
  ticketId: r.ticketId,
  step: r.step,
  status: r.status,
  endedAt: r.endedAt,
  costUsd: r.costUsd,
  costIsEstimate: r.costIsEstimate,
  usage: r.usage,
  quotaDelta: r.quotaDelta,
  metrics: r.metrics,
});

/** What the figures are computed from; for several projects, their data concatenated. */
export interface DashboardData {
  tickets: readonly Ticket[];
  /** History (oldest first) of the tickets that changed in the window, by ticket id. */
  ticketEvents: ReadonlyMap<string, readonly TicketEvent[]>;
  /** Runs whose `endedAt` is in the window. */
  endedRuns: readonly DashboardRunInput[];
  partial: readonly DashboardFigure[];
}

/** `weeks` (default 8, clamped to 1–26) whole UTC weeks, Monday first, the last ending now. */
export function dashboardWindow(now: Date, weeks?: number): DashboardWindow {
  const n = Math.min(
    DASHBOARD_MAX_WEEKS,
    Math.max(1, Math.floor(weeks ?? DASHBOARD_DEFAULT_WEEKS)),
  );
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sinceMonday = (now.getUTCDay() + 6) % 7;
  const thisMonday = midnight - sinceMonday * 24 * HOUR_MS;
  return { from: new Date(thisMonday - (n - 1) * WEEK_MS), to: now, weeks: n };
}

/** Partial figures for each cap that was reached. */
export function partialFigures(caps: {
  ticketsCapped: boolean;
  runsCapped: boolean;
}): DashboardFigure[] {
  return [
    ...(caps.ticketsCapped ? (["ticketsByStage", "leadTime", "reworks"] as const) : []),
    ...(caps.runsCapped
      ? (["ciGreenFirstTry", "reviewBlockers", "cost", "expensiveRuns"] as const)
      : []),
  ];
}

/** The weekly figures and most expensive runs for a window. Pure: same data, same figures. */
export function dashboardFigures(
  window: DashboardWindow,
  data: DashboardData,
): Pick<ProjectDashboard, "from" | "to" | "weeks" | "expensiveRuns" | "partial"> {
  const starts = Array.from(
    { length: window.weeks },
    (_, i) => window.from.getTime() + i * WEEK_MS,
  );
  const ends = starts.map((s) => Math.min(s + WEEK_MS, window.to.getTime()));
  const weekOf = (iso: string): number | null => {
    const t = Date.parse(iso);
    if (Number.isNaN(t) || t < window.from.getTime() || t > window.to.getTime()) return null;
    return Math.min(window.weeks - 1, Math.floor((t - window.from.getTime()) / WEEK_MS));
  };

  const ticketsById = new Map(data.tickets.map((t) => [t.id, t]));
  const runs = data.endedRuns.filter(
    (r) => !ACTIVE_RUN_STATUSES.includes(r.status) && r.endedAt && weekOf(r.endedAt) !== null,
  );

  const weeks: DashboardWeek[] = starts.map((start, i) => {
    const end = ends[i]!;
    const inWeek = (iso: string) => weekOf(iso) === i;
    const weekRuns = runs.filter((r) => inWeek(r.endedAt!));
    const leadTimes: number[] = [];
    let reworks = 0;
    for (const events of data.ticketEvents.values()) {
      const moves = events.filter((e) => e.kind === "stage_changed");
      for (const e of moves) {
        if (!inWeek(e.createdAt)) continue;
        if (e.data.from === "ready_for_review" && e.data.to === "in_progress") reworks++;
        if (e.data.to === "done") {
          const hours = leadTimeHours(moves, e);
          if (hours !== null) leadTimes.push(hours);
        }
      }
    }
    const withMetrics = weekRuns.filter((r) => r.metrics);
    const known = withMetrics.filter((r) => r.metrics!.ciGreenFirstTry !== null);
    const green = known.filter((r) => r.metrics!.ciGreenFirstTry === true).length;
    const sizeOf = (r: DashboardRunInput): DashboardSize =>
      (r.ticketId ? ticketsById.get(r.ticketId)?.size : null) ?? "unsized";
    return {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      ticketsByStage: stageCounts(data, new Date(end).toISOString()),
      leadTimeHours: {
        median: percentile(leadTimes, 0.5),
        p90: percentile(leadTimes, 0.9),
        count: leadTimes.length,
      },
      reworks,
      ciGreenFirstTry: {
        green,
        known: known.length,
        rate: known.length === 0 ? null : round(green / known.length, 3),
      },
      reviewBlockers: withMetrics.reduce((n, r) => n + (r.metrics!.reviewBlockers ?? 0), 0),
      cost: costOf(weekRuns),
      byStep: RunStep.options.map((step) => ({
        step,
        ...costOf(weekRuns.filter((r) => r.step === step)),
      })),
      bySize: DashboardSize.options.map((size) => ({
        size,
        ...costOf(weekRuns.filter((r) => sizeOf(r) === size)),
      })),
    };
  });

  return {
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    weeks,
    expensiveRuns: expensiveRuns(runs, ticketsById),
    partial: [...new Set(data.partial)],
  };
}

/**
 * Hours from the ticket's first move into Ready (or In progress, if it skipped Ready) since its
 * previous move into Done, to `done`; null when it entered neither in between. A re-opened
 * ticket so counts once per completion, each measured from its own start.
 */
function leadTimeHours(moves: readonly TicketEvent[], done: TicketEvent): number | null {
  const at = moves.indexOf(done);
  const previousDone = moves.slice(0, at).findLastIndex((e) => e.data.to === "done");
  const cycle = moves.slice(previousDone + 1, at);
  const started =
    cycle.find((e) => e.data.to === "ready") ?? cycle.find((e) => e.data.to === "in_progress");
  if (!started) return null;
  return round((Date.parse(done.createdAt) - Date.parse(started.createdAt)) / HOUR_MS, 1);
}

/**
 * Tickets per stage at `at`. A ticket with no history read hasn't changed since the window
 * began, so its current stage held all along; one with history replays its stage moves.
 */
function stageCounts(data: DashboardData, at: string): Record<Stage, number> {
  const counts = Object.fromEntries(Stage.options.map((s) => [s, 0])) as Record<Stage, number>;
  for (const ticket of data.tickets) {
    if (ticket.createdAt > at) continue;
    const moves = (data.ticketEvents.get(ticket.id) ?? []).filter(
      (e) => e.kind === "stage_changed",
    );
    let stage = moves.length > 0 ? asStage(moves[0]!.data.from) : ticket.stage;
    for (const e of moves) if (e.createdAt <= at) stage = asStage(e.data.to) ?? stage;
    if (stage) counts[stage]++;
  }
  return counts;
}

function asStage(value: unknown): Stage | null {
  const parsed = Stage.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const knownCost = (r: DashboardRunInput): r is DashboardRunInput & { costUsd: number } =>
  r.usage !== null && r.costUsd !== null;

function costOf(runs: readonly DashboardRunInput[]): DashboardCost {
  const total: DashboardCost = {
    runs: runs.length,
    unknownCostRuns: 0,
    estimatedCostUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    turns: 0,
    quotaDelta: { "5h": null, weekly: null },
  };
  for (const r of runs) {
    if (knownCost(r)) total.estimatedCostUsd += r.costUsd;
    else total.unknownCostRuns++;
    if (r.usage) {
      total.tokensIn += r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens;
      total.tokensOut += r.usage.outputTokens;
      total.turns += r.usage.turns ?? 0;
    }
    total.quotaDelta = {
      "5h": addPct(total.quotaDelta["5h"], r.quotaDelta?.["5h"]),
      weekly: addPct(total.quotaDelta.weekly, r.quotaDelta?.weekly),
    };
  }
  total.estimatedCostUsd = round(total.estimatedCostUsd, 6);
  return total;
}

function expensiveRuns(
  runs: readonly DashboardRunInput[],
  ticketsById: ReadonlyMap<string, Ticket>,
): DashboardRun[] {
  return runs
    .filter(knownCost)
    .sort((a, b) => b.costUsd - a.costUsd || b.endedAt!.localeCompare(a.endedAt!))
    .slice(0, DASHBOARD_EXPENSIVE_RUNS)
    .map((r) => ({
      id: r.id,
      projectId: r.projectId,
      ticketId: r.ticketId,
      ticketKey: (r.ticketId && ticketsById.get(r.ticketId)?.key) || null,
      step: r.step,
      costUsd: r.costUsd,
      costIsEstimate: r.costIsEstimate,
      endedAt: r.endedAt!,
    }));
}

/** Nearest-rank percentile; null for no samples. */
function percentile(samples: readonly number[], p: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

const addPct = (total: number | null, delta: number | null | undefined) =>
  delta === null || delta === undefined ? total : round((total ?? 0) + delta, 1);

const round = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/** Gathers one project's dashboard data, or every project's, under the read caps. */
export class DashboardReader {
  constructor(
    private readonly tracker: WorkTracker,
    private readonly runs: RunStore,
  ) {}

  async project(projectId: string, window: DashboardWindow): Promise<ProjectDashboard> {
    const project = await this.tracker.getProject(projectId);
    if (!project) throw notFound("project", projectId);
    const data = await this.read(project, window);
    return { projectId: project.id, key: project.key, ...dashboardFigures(window, data) };
  }

  /** Projects are read one after another, so at most one project's runs are held at a time. */
  async all(window: DashboardWindow): Promise<Dashboard> {
    const projects = (await this.tracker.listProjects()).sort((a, b) => a.key.localeCompare(b.key));
    const covered = projects.slice(0, MAX_DASHBOARD_PROJECTS);
    const perProject: ProjectDashboard[] = [];
    const merged = {
      tickets: [] as Ticket[],
      ticketEvents: new Map<string, readonly TicketEvent[]>(),
      endedRuns: [] as DashboardRunInput[],
      partial: (covered.length < projects.length ? ["projects"] : []) as DashboardFigure[],
    };
    for (const project of covered) {
      const data = await this.read(project, window);
      perProject.push({
        projectId: project.id,
        key: project.key,
        ...dashboardFigures(window, data),
      });
      merged.tickets.push(...data.tickets);
      for (const [id, events] of data.ticketEvents) merged.ticketEvents.set(id, events);
      merged.endedRuns.push(...data.endedRuns);
      merged.partial.push(...data.partial);
    }
    return { ...dashboardFigures(window, merged), projects: perProject };
  }

  private async read(project: Project, window: DashboardWindow): Promise<DashboardData> {
    const from = window.from.toISOString();
    const [tickets, ended] = await Promise.all([
      this.tracker.listTickets(project.id),
      this.runs.listEndedBetween(project.id, from, window.to.toISOString(), MAX_DASHBOARD_RUNS),
    ]);
    // A ticket unchanged since the window began has no stage moves in it to replay.
    const changed = tickets
      .filter((t) => t.updatedAt >= from)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const read = changed.slice(0, MAX_DASHBOARD_TICKET_READS);
    const histories = await Promise.all(
      read.map(async (t) => [t.id, await this.tracker.listEvents(project.id, t.id)] as const),
    );
    return {
      tickets,
      ticketEvents: new Map(histories),
      endedRuns: ended.runs.map(slim),
      partial: partialFigures({
        ticketsCapped: changed.length > read.length,
        runsCapped: !ended.complete,
      }),
    };
  }
}
