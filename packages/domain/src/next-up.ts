import {
  DIGEST_NEXT_UP_MAX,
  type DigestNextUpItem,
  type DispatchIdleReason,
  type Project,
  type QuotaLevel,
  type QuotaStore,
  type Run,
  type RunStore,
  type Stage,
  type Ticket,
} from "@andy/contracts";
import { MAX_BUILD_RUNS_PER_TICKET, isAndysWork, unfinishedBlockers } from "./builds";
import {
  MAX_ACTIVE_RUNS_AT_WARN,
  MAX_ACTIVE_RUNS_GLOBAL,
  MAX_PRS_WAITING_PER_PROJECT,
  isInFlight,
  mayDispatch,
  wasDispatched,
} from "./dispatch-caps";
import { blockingRun, editingRuns } from "./dispatch-conflicts";
import { checkDor } from "./dor";
import { routeTakes, resolveExecutor, type DispatchRoute } from "./executor";
import { epicOf, withEpicOverrides } from "./overrides";
import { planRequired } from "./plans";
import { dispatchQuotaLevel, subscriptionQuotaLevels } from "./route-fallback";
import type { EffectiveRouting } from "./route-resolver";
import { isDispatchable } from "./worker";

/**
 * What the build dispatcher would take next (AI-385), as a dry run: the same checks, in the same
 * order, as `BuildDispatcher.dispatch`, over data already read. Pure: it starts, reserves and
 * writes nothing. `readySkip` is the dispatcher's own first filter; the rest reuses the pure
 * rules it calls (`mayDispatch`, `blockingRun`, `checkDor`, `unfinishedBlockers`).
 *
 * Not checked here, since each needs reads per ticket or a live call: a night launch's limits,
 * a plan that awaits Andy or was rejected, and a spend cap (found only when a task starts).
 */

/** Why the dispatcher passes over a Ready ticket before any read (`BuildDispatcher.dispatch`). */
export type ReadySkip =
  "epic" | "andys_work" | "not_agent" | "other_executor" | "archived" | "needs_you";

/** The fields of a project the dispatcher's selection reads. */
export type DispatchProject = Pick<
  Project,
  | "id"
  | "key"
  | "autoBuild"
  | "buildEnabled"
  | "paused"
  | "runsAtOnce"
  | "defaultWorker"
  | "executor"
  | "planApproval"
>;

/**
 * The dispatcher's first filter, in its order: an epic never runs (ADR-0058), Andy's own work
 * never builds, the worker must be an agent (ADR-0082), the route must take it (ADR-0089), and
 * an archived or Needs-you ticket waits. Null: the ticket goes on to the holds and reads.
 */
export function readySkip(
  ticket: Ticket,
  tickets: readonly Ticket[],
  project: Pick<Project, "id" | "defaultWorker" | "executor">,
  route: DispatchRoute,
  runnerPresent: boolean,
): ReadySkip | null {
  // AI-116: an epic's overrides hold its children too, unless a child has its own pick.
  const effective = withEpicOverrides(ticket, epicOf(ticket, tickets));
  if (ticket.type === "epic") return "epic";
  if (isAndysWork(effective)) return "andys_work";
  if (!isDispatchable(effective, project)) return "not_agent";
  if (!routeTakes(route, ticket, project, runnerPresent)) return "other_executor";
  if (ticket.archived) return "archived";
  if (ticket.needsAttention) return "needs_you";
  return null;
}

/** What the dispatcher reads besides tickets: the same sources it asks before it starts. */
export interface DispatchFacts {
  /** An executor is configured on this instance (`RunService.canDispatch`). */
  canDispatch: boolean;
  runnerPresent: boolean;
  /** Agent tasks in flight across all projects (`RunService.activeCounts`). */
  globalActive: number;
  /** The worst level of the subscriptions the project's routing dispatches on. */
  quotaLevel: QuotaLevel;
}

export interface NextUpInput {
  project: DispatchProject;
  /** Every ticket in the project (the snapshot). */
  tickets: readonly Ticket[];
  openQuestions: ReadonlyMap<string, number>;
  /** The project's agent tasks queued or running. */
  activeRuns: readonly Run[];
  /** Agent tasks already read per ticket id (newest first); a ticket missing here isn't read. */
  ticketRuns: ReadonlyMap<string, readonly Run[]>;
  /** Why a ticket waits on its milestone (`MilestoneHolds`), by ticket id; absent: it doesn't. */
  milestoneHolds: ReadonlyMap<string, string>;
  facts: DispatchFacts;
  now: Date;
}

export interface NextUp {
  items: DigestNextUpItem[];
  truncated: boolean;
  idle: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The idle reasons in plain words; the digest's exceptions use the same lines. */
export function idleText(reason: DispatchIdleReason, project: Pick<Project, "runsAtOnce">): string {
  switch (reason) {
    case "paused":
      return "Dispatch is paused";
    case "project_cap":
      return `Dispatch is at the project's dial (${plural(project.runsAtOnce, "agent task")} at once)`;
    case "global_cap":
      return `Dispatch is at the global cap (${MAX_ACTIVE_RUNS_GLOBAL} agent tasks at once)`;
    case "prs_waiting_cap":
      return `Dispatch is idle: ${MAX_PRS_WAITING_PER_PROJECT} PRs wait for Andy`;
    case "quota_reserve":
      return "Dispatch is idle: quota is at the reserve";
    case "quota_warn":
      return `Dispatch is at the warn cap (${plural(MAX_ACTIVE_RUNS_AT_WARN, "agent task")} at once while quota is at warn)`;
    case "spend_cap":
      return "Dispatch is idle: a paid agent task would pass a spend cap";
  }
}

const STAGE_TEXT: Record<Stage, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In progress",
  ready_for_review: "Ready for review",
  verifying: "Verifying",
  done: "Done",
  cancelled: "Cancelled",
};

const named = (t: Pick<Ticket, "key" | "title">) => `${t.key}: ${t.title}`;

/**
 * The Ready tickets in the dispatcher's order (rank), up to `DIGEST_NEXT_UP_MAX`, each marked
 * starts now, next, or skipped with why; and one line on why nothing (more) starts now.
 */
export function nextUp(input: NextUpInput): NextUp {
  const { project, tickets, facts, now } = input;
  const byRef = new Map<string, Ticket>();
  for (const t of tickets) {
    byRef.set(t.key, t);
    byRef.set(t.id, t);
  }
  const ready = tickets
    .filter((t) => t.stage === "ready" && t.type !== "epic" && !t.archived)
    .sort((a, b) => a.rank.localeCompare(b.rank) || a.key.localeCompare(b.key));

  const off = gateOff(project, facts);
  const counts = {
    projectActive: input.activeRuns.filter((r) => r.step !== "sync" && isInFlight(r, now)).length,
    globalActive: facts.globalActive,
    prsWaiting: prsWaiting(tickets, input.ticketRuns),
    quotaLevel: facts.quotaLevel,
  };
  // Build runs in flight, plus the ones this dry run would start (ADR-0080).
  const inFlight = editingRuns(input.activeRuns, now);
  const wouldStart = new Set<string>();
  let verdict = off ? null : mayDispatch(project, counts);

  const items: DigestNextUpItem[] = [];
  for (const ticket of ready.slice(0, DIGEST_NEXT_UP_MAX)) {
    const why = skipReason(ticket, input, byRef, inFlight, wouldStart);
    if (why !== null) {
      items.push({ ...label(ticket), status: "skipped", reason: why });
      continue;
    }
    const note = planRequired(project.planApproval, ticket)
      ? "Starts with a plan run (plan approval is on), unless an approved plan exists"
      : null;
    if (verdict !== "start") {
      items.push({ ...label(ticket), status: "next", reason: note });
      continue;
    }
    items.push({ ...label(ticket), status: "starts_now", reason: note });
    wouldStart.add(ticket.id);
    inFlight.push(dryRun(ticket, now));
    counts.projectActive += 1;
    counts.globalActive += 1;
    verdict = mayDispatch(project, counts);
  }

  return {
    items,
    truncated: ready.length > DIGEST_NEXT_UP_MAX,
    idle: idleLine(off, verdict, project, ready.length, wouldStart.size),
  };
}

/** Why nothing starts on its own before any cap is asked, or null when dispatch runs. */
function gateOff(project: DispatchProject, facts: DispatchFacts): string | null {
  if (!facts.canDispatch) return "Nothing starts on its own: no executor is set up here";
  if (!project.buildEnabled) return "Nothing starts on its own: builds are off for this project";
  if (!project.autoBuild) {
    return "Nothing starts on its own: auto-build is off, so Andy starts each build";
  }
  return null;
}

function idleLine(
  off: string | null,
  verdict: "start" | DispatchIdleReason | null,
  project: DispatchProject,
  readyCount: number,
  started: number,
): string {
  if (off) return off;
  if (verdict !== null && verdict !== "start") {
    const why = idleText(verdict, project);
    return started > 0 ? `${plural(started, "ticket")} would start; then: ${why}` : why;
  }
  if (readyCount === 0) return "Nothing more starts: no ticket is in Ready";
  return started > 0
    ? `${plural(started, "ticket")} would start; no other Ready ticket can start now`
    : "Nothing starts: no Ready ticket can start now (see why each is skipped)";
}

/** The dispatcher's skips, in its order, as one plain sentence; null when it would take it. */
function skipReason(
  ticket: Ticket,
  input: NextUpInput,
  byRef: ReadonlyMap<string, Ticket>,
  inFlight: readonly Run[],
  wouldStart: ReadonlySet<string>,
): string | null {
  const { project, tickets, facts } = input;
  const route: DispatchRoute = { kind: "actions" };
  const first = readySkip(ticket, tickets, project, route, facts.runnerPresent);
  if (first) return readySkipText(first, ticket, project, facts.runnerPresent);

  const hold = input.milestoneHolds.get(ticket.id);
  if (hold) return hold;

  const blocker = blockingRun(ticket, inFlight);
  if (blocker) {
    const other = blocker.ticketId ? byRef.get(blocker.ticketId) : undefined;
    const who = other ? named(other) : "an agent task";
    const when = other && wouldStart.has(other.id) ? "which would start first" : "building now";
    return `Its files overlap ${who}, ${when}`;
  }

  const dor = checkDor(ticket, input.openQuestions.get(ticket.id) ?? 0);
  if (!dor.met) return `Definition of Ready not met: ${dor.missing.join(", ")}`;

  const stages = new Map<string, Stage>();
  for (const ref of ticket.blockedBy) {
    const t = byRef.get(ref);
    if (t) stages.set(ref, t.stage);
  }
  const open = unfinishedBlockers(ticket, stages);
  if (open.length > 0) {
    const names = open.map((ref) => {
      const t = byRef.get(ref);
      return t ? `${named(t)} (${STAGE_TEXT[t.stage]})` : `${ref} (not in this project's tickets)`;
    });
    return `Blocked by ${names.join("; ")}`;
  }

  const runs = input.ticketRuns.get(ticket.id);
  const builds = runs?.filter((r) => r.step === "build" && wasDispatched(r)).length ?? 0;
  if (builds >= MAX_BUILD_RUNS_PER_TICKET) {
    return `Build ran ${builds} times without a merged change: Andy finishes it by hand`;
  }
  return null;
}

function readySkipText(
  skip: ReadySkip,
  ticket: Ticket,
  project: Pick<Project, "executor">,
  runnerPresent: boolean,
): string {
  switch (skip) {
    case "epic":
      return "An epic never builds";
    case "andys_work":
      return "Assigned to Andy: he does it himself";
    case "not_agent":
      return "Its worker isn't an agent";
    case "other_executor":
      return resolveExecutor(ticket, project, runnerPresent) === "wait"
        ? "Waits for the local runner, which is away"
        : "Runs on the local runner, which takes it when it claims work";
    case "archived":
      return "Archived";
    case "needs_you":
      return "Waits on Andy (Needs-you)";
  }
}

/** Open PRs the system opened in the project, as the dispatcher counts them for its cap. */
function prsWaiting(
  tickets: readonly Ticket[],
  ticketRuns: ReadonlyMap<string, readonly Run[]>,
): number {
  return tickets.filter(
    (t) =>
      t.stage === "ready_for_review" &&
      (ticketRuns.get(t.id) ?? []).some((r) => r.step === "build" && r.links.pullRequest),
  ).length;
}

/** A stand-in for a build the dry run would start: only what the overlap check reads. */
function dryRun(ticket: Ticket, now: Date): Run {
  return {
    id: `dry-run:${ticket.id}`,
    ticketId: ticket.id,
    step: "build",
    status: "queued",
    touches: [...ticket.touches],
    deadline: null,
    createdAt: now.toISOString(),
  } as unknown as Run;
}

const label = (t: Pick<Ticket, "key" | "title">) => ({ ticketKey: t.key, title: t.title });

/**
 * Reads `DispatchFacts` from the sources the dispatcher asks: the executor, runner presence,
 * agent tasks in flight everywhere (`isInFlight`, as `RunService.activeCounts` counts them), and
 * quota under the project's routing. Reads only. The caller passes what it already read (every
 * project, this project's active tasks), so only the other projects' active tasks are read.
 */
export class DispatchFactsReader {
  constructor(
    private readonly runs: {
      readonly canDispatch: boolean;
      runnerPresent(projectId: string): Promise<boolean>;
      routingOf(projectId: string): Promise<EffectiveRouting>;
    },
    private readonly runStore: Pick<RunStore, "listActive">,
    private readonly quota: Pick<QuotaStore, "latest"> | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async facts(
    projectId: string,
    known: { projects: readonly Pick<Project, "id">[]; active: readonly Run[] },
  ): Promise<DispatchFacts> {
    const others = known.projects.filter((p) => p.id !== projectId);
    const [runnerPresent, routing, elsewhere] = await Promise.all([
      this.runs.runnerPresent(projectId),
      this.runs.routingOf(projectId),
      Promise.all(others.map((p) => this.runStore.listActive(p.id))),
    ]);
    const now = this.now();
    const levels = await subscriptionQuotaLevels(this.quota, routing, now);
    return {
      canDispatch: this.runs.canDispatch,
      runnerPresent,
      globalActive: [...known.active, ...elsewhere.flat()].filter((r) => isInFlight(r, now)).length,
      quotaLevel: dispatchQuotaLevel(levels, routing.providers),
    };
  }
}
