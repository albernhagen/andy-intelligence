import {
  NIGHT_LIMITS,
  NightBudget,
  StartNightLaunch,
  notFound,
  type EventActor,
  type LaunchProblem,
  type NightEndReason,
  type NightLaunch,
  type NightLaunchStore,
  type Stage,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import { DomainError } from "./errors";
import type { PlanState } from "./plans";
import { requireCan } from "./permissions";

/**
 * Night launch (ADR-0049 "Launch step" and "Night budget", M4.16). Before Andy steps away he
 * launches an epic: every story Ready, its questions answered, its M/L plan approved, a budget
 * and a stop time. The launch is refused while anything is open, with every problem listed by
 * ticket key. Nothing dispatches from a launch yet (M4.18 onwards).
 */

/** A child of the epic as the readiness check sees it. */
export interface LaunchChild {
  ticket: Pick<Ticket, "key" | "stage" | "size" | "archived">;
  /** Open questions on the ticket. */
  openQuestions: number;
  /** Where its latest plan stands (`planState`). */
  plan: PlanState["kind"];
}

export interface LaunchRequest {
  budget: { maxRuns?: number | null; maxTokens?: number | null; maxUsd?: number | null };
  stopAt?: string | null;
  now: Date;
  /** The project's active launch (running or stopping), or null. */
  active: Pick<NightLaunch, "epicKey" | "status"> | null;
}

/** Children in these stages are finished: a launch doesn't cover them. */
const FINISHED: readonly Stage[] = ["done", "cancelled"];

const STAGE_LABEL: Record<Stage, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In progress",
  ready_for_review: "Ready for review",
  done: "Done",
  cancelled: "Cancelled",
};

const PLAN_LABEL: Record<PlanState["kind"], string> = {
  none: "no plan",
  planning: "plan still running",
  awaiting: "plan awaiting approval",
  approved: "plan approved",
  rejected: "plan rejected",
  stale: "plan stale",
};

/** The children a launch covers: not archived, not Done or Cancelled. */
export function launchStories<C extends Pick<LaunchChild, "ticket">>(children: readonly C[]): C[] {
  return children.filter((c) => !c.ticket.archived && !FINISHED.includes(c.ticket.stage));
}

/**
 * Everything that blocks launching `epic` with `children` (its child tickets). Empty means the
 * launch may start. Pure; `NightLaunches` gathers the facts.
 */
export function launchProblems(
  epic: Pick<Ticket, "key" | "type">,
  children: readonly LaunchChild[],
  request: LaunchRequest,
): LaunchProblem[] {
  const problems: LaunchProblem[] = [];
  const add = (kind: LaunchProblem["kind"], ticketKey: string | null, message: string) =>
    problems.push({ kind, ticketKey, message });

  if (epic.type !== "epic") add("not_epic", epic.key, `${epic.key} is not an epic`);
  const stories = launchStories(children);
  if (stories.length === 0) add("no_stories", epic.key, `${epic.key} has no open stories`);
  if (stories.length > NIGHT_LIMITS.maxStories) {
    add(
      "too_many_stories",
      epic.key,
      `${epic.key} has ${stories.length} open stories; at most ${NIGHT_LIMITS.maxStories}`,
    );
  }
  for (const { ticket, openQuestions, plan } of stories) {
    if (openQuestions > 0) {
      const noun = openQuestions === 1 ? "question" : "questions";
      add("open_questions", ticket.key, `${ticket.key}: ${openQuestions} open ${noun}`);
    }
    if (ticket.stage !== "ready") {
      add("not_ready", ticket.key, `${ticket.key}: in ${STAGE_LABEL[ticket.stage]}, not Ready`);
    }
    // An unsized ticket can't be told apart from M or L (`planRequired`), so it needs a plan too.
    if (ticket.size !== "S" && plan !== "approved") {
      const size = ticket.size ?? "unsized";
      add("plan_not_approved", ticket.key, `${ticket.key}: size ${size}, ${PLAN_LABEL[plan]}`);
    }
  }
  budgetProblems(request.budget, add);
  stopTimeProblems(request, add);
  if (request.active) {
    const { epicKey, status } = request.active;
    add("launch_running", epicKey, `a launch for ${epicKey} is ${status} in this project`);
  }
  return problems;
}

type Add = (kind: LaunchProblem["kind"], ticketKey: string | null, message: string) => void;

const BUDGET_FIELDS = [
  { field: "maxRuns", label: "max agent tasks", whole: true },
  { field: "maxTokens", label: "max tokens", whole: true },
  { field: "maxUsd", label: "max USD", whole: false },
] as const;

function budgetProblems(budget: LaunchRequest["budget"], add: Add): void {
  for (const { field, label, whole } of BUDGET_FIELDS) {
    const value = budget[field];
    const cap = NIGHT_LIMITS[field];
    if (value === null || value === undefined) {
      add("budget_missing", null, `budget: ${label} is missing`);
    } else if (!(Number.isFinite(value) && value > 0) || (whole && !Number.isInteger(value))) {
      const what = whole ? "a positive whole number" : "positive";
      add("budget_not_positive", null, `budget: ${label} must be ${what}`);
    } else if (value > cap) {
      add("budget_over_cap", null, `budget: ${label} is over the cap of ${cap}`);
    }
  }
}

function stopTimeProblems(request: LaunchRequest, add: Add): void {
  if (!request.stopAt) {
    add("stop_time_missing", null, "stop time is missing");
    return;
  }
  const stop = Date.parse(request.stopAt);
  const now = request.now.getTime();
  if (stop <= now) add("stop_time_past", null, "stop time is in the past");
  else if (stop - now > NIGHT_LIMITS.maxHours * 3_600_000) {
    add("stop_time_too_far", null, `stop time is more than ${NIGHT_LIMITS.maxHours} hours away`);
  }
}

/** Where a ticket's latest plan stands; `RunService.planStateOf` is the real one. */
export interface PlanStates {
  planStateOf(ticket: Ticket): Promise<PlanState>;
}

function log(severity: "INFO" | "WARNING", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "night-launch", ...fields }));
}

/** The launch's readiness: the problems, and what a launch would cover. */
export interface LaunchCheck {
  epic: Ticket;
  storyKeys: string[];
  problems: LaunchProblem[];
}

export class NightLaunches {
  constructor(
    private readonly store: NightLaunchStore,
    private readonly tracker: WorkTracker,
    private readonly plans: PlanStates,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  /** Everything that blocks launching the epic now; the UI shows it as the checklist. */
  async check(projectId: string, input: StartNightLaunch): Promise<LaunchCheck> {
    const parsed = StartNightLaunch.parse(input);
    const epic = await this.tracker.getTicket(projectId, parsed.epicId);
    if (!epic) throw notFound("ticket", parsed.epicId);
    const children = (await this.tracker.listTickets(projectId)).filter(
      (t) => t.parentId === epic.id,
    );
    const stories = await Promise.all(
      launchStories(children.map((ticket) => ({ ticket }))).map(async ({ ticket }) => ({
        ticket,
        openQuestions: (await this.tracker.listQuestions({ ticketId: ticket.id, status: "open" }))
          .length,
        plan: (await this.plans.planStateOf(ticket)).kind,
      })),
    );
    const problems = launchProblems(epic, stories, {
      budget: parsed.budget,
      stopAt: parsed.stopAt,
      now: this.now(),
      active: await this.store.findActive(projectId),
    });
    return { epic, storyKeys: stories.map((s) => s.ticket.key), problems };
  }

  /**
   * Owner-only (`start_run`: a launch starts agent tasks). Refused (`not_buildable`, each problem
   * a detail line) while `check` lists any problem; the store refuses a second active launch
   * that races this one (`conflict`).
   */
  async start(projectId: string, input: StartNightLaunch, actor: EventActor): Promise<NightLaunch> {
    requireCan(actor, "start_run", projectId);
    const { epic, storyKeys, problems } = await this.check(projectId, input);
    if (problems.length > 0) {
      log("INFO", "night launch refused", { projectId, epic: epic.key, problems });
      throw new DomainError(
        "not_buildable",
        `${epic.key} can't be launched yet`,
        problems.map((p) => p.message),
      );
    }
    const parsed = StartNightLaunch.parse(input);
    const at = this.now().toISOString();
    const launch = await this.store.create({
      id: this.newId(),
      projectId,
      epicId: epic.id,
      epicKey: epic.key,
      budget: NightBudget.parse(parsed.budget),
      stopAt: parsed.stopAt!,
      status: "running",
      storyKeys,
      createdAt: at,
      createdBy: actor,
      startedAt: at,
      endedAt: null,
      endReason: null,
    });
    log("INFO", "night launch started", { projectId, epic: epic.key, launchId: launch.id });
    return launch;
  }

  /** Owner-only. No new agent tasks from here; in-flight ones finish (ADR-0049). */
  async stop(launchId: string, actor: EventActor): Promise<NightLaunch> {
    const launch = await this.require(launchId);
    requireCan(actor, "start_run", launch.projectId);
    const stopped = await this.store.transition(launchId, ["running"], { status: "stopping" });
    log("INFO", "night launch stopping", { launchId, actor });
    return stopped;
  }

  /** Ends a running or stopping launch with its reason (the system calls this, M4.18). */
  async end(launchId: string, reason: NightEndReason): Promise<NightLaunch> {
    const ended = await this.store.transition(launchId, ["running", "stopping"], {
      status: "ended",
      endedAt: this.now().toISOString(),
      endReason: reason,
    });
    log("INFO", "night launch ended", { launchId, reason });
    return ended;
  }

  private async require(launchId: string): Promise<NightLaunch> {
    const launch = await this.store.get(launchId);
    if (!launch) throw notFound("night launch", launchId);
    return launch;
  }
}
