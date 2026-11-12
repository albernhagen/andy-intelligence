import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  LaunchProblem,
  NIGHT_LIMITS,
  NightLaunchFields,
  Size,
  Stage,
  WorkTrackerError,
  notFound,
  type EventActor,
  type NightLaunch,
  type NightLaunchStore,
  type RunStore,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import { settleNight, type NightLaunches, type PlanState } from "@andy/domain";
import { actorOf, type AuthEnv } from "./auth";

/**
 * The night launch step (M4.17, ADR-0049 "Launch step"): an epic's launch checklist, start and
 * stop, under /api (Firebase sign-in + allow-list), the same reads and rules as the MCP tools.
 * Starting and stopping are owner-only through `NightLaunches` (the permission function, `start_run`).
 * Nothing dispatches from a launch yet: budget enforcement is M4.18.
 */

/** What the night routes and tools read and write. */
export interface NightDeps {
  nights: NightLaunches;
  store: NightLaunchStore;
  tracker: WorkTracker;
  runs: RunStore;
  plans: { planStateOf(ticket: Ticket): Promise<PlanState> };
  now?: () => Date;
}

/** Launch problems that are about the stories (not the budget or stop time Andy types in). */
const FORM_PROBLEMS: readonly LaunchProblem["kind"][] = [
  "budget_missing",
  "budget_not_positive",
  "budget_over_cap",
  "stop_time_missing",
  "stop_time_past",
  "stop_time_too_far",
];

const ACTIVE_RUN = new Set(["queued", "running"]);

/** A stored launch as the API returns it (`NightLaunch` without its cross-field checks). */
const NightLaunchBody = z.object(NightLaunchFields.shape).openapi("NightLaunch");

export const NightChecklistStory = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  stage: Stage,
  size: Size.nullable(),
  /** Open questions, each answered on the ticket page. */
  questions: z.array(z.object({ id: z.string(), text: z.string() })),
  /** Its latest plan: kind as `planState` reads it, and the plan's agent task when there is one. */
  plan: z.object({
    kind: z.enum(["none", "planning", "awaiting", "approved", "rejected", "stale"]),
    runId: z.string().nullable(),
  }),
});

export const NightProgress = z.object({
  /** Stories (the launch's `storyKeys`) by where they stand now. */
  stories: z.object({
    total: z.number().int(),
    done: z.number().int(),
    running: z.number().int(),
    /** Flagged Needs-you or cancelled: the night won't move them on. */
    stopped: z.number().int(),
    waiting: z.number().int(),
  }),
  /** Spend of the stories' agent tasks created since the launch started, against its budget. */
  spend: z.object({
    runs: z.number().int(),
    tokens: z.number().int(),
    estimatedUsd: z.number(),
    /** Finished agent tasks with no usage report: their cost is unknown, never $0. */
    unknownRuns: z.number().int(),
  }),
});

export const NightStatus = z
  .object({
    epicKey: z.string(),
    /** Stories a launch would cover now, with their open questions and plans (at most 50). */
    stories: z.array(NightChecklistStory),
    /** What blocks a launch, by ticket key: the budget and stop time are checked on Launch. */
    problems: z.array(LaunchProblem),
    /** The epic's latest launch, if any, with its progress. */
    launch: NightLaunchBody.nullable(),
    progress: NightProgress.nullable(),
    limits: z.object({
      maxRuns: z.number(),
      maxTokens: z.number(),
      maxUsd: z.number(),
      maxHours: z.number(),
    }),
  })
  .openapi("NightStatus");
export type NightStatus = z.infer<typeof NightStatus>;

export const LaunchNightBody = z
  .strictObject({
    budget: z.strictObject({
      maxRuns: z.number().nullable().optional(),
      maxTokens: z.number().nullable().optional(),
      maxUsd: z.number().nullable().optional(),
    }),
    stopAt: z.iso.datetime().nullable().optional(),
  })
  .openapi("LaunchNight");
export type LaunchNightBody = z.infer<typeof LaunchNightBody>;

/** The epic's checklist, problems and latest launch with progress. */
export async function readNightStatus(deps: NightDeps, epic: Ticket): Promise<NightStatus> {
  await settleNight(deps, epic.projectId);
  const { storyKeys, problems } = await deps.nights.check(epic.projectId, { epicId: epic.id });
  const byKey = new Map(
    (await deps.tracker.listTickets(epic.projectId))
      .filter((t) => t.parentId === epic.id)
      .map((t) => [t.key, t]),
  );
  // `check` reads no story facts past NIGHT_LIMITS.maxStories, and neither does the checklist.
  const covered =
    storyKeys.length > NIGHT_LIMITS.maxStories
      ? []
      : storyKeys.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));
  const stories = await Promise.all(
    covered.map(async (t) => {
      const plan = await deps.plans.planStateOf(t);
      const questions = await deps.tracker.listQuestions({ ticketId: t.id, status: "open" });
      return {
        id: t.id,
        key: t.key,
        title: t.title,
        stage: t.stage,
        size: t.size ?? null,
        questions: questions.map((q) => ({ id: q.id, text: q.text })),
        plan: { kind: plan.kind, runId: "run" in plan ? plan.run.id : null },
      };
    }),
  );
  const launch = await latestLaunch(deps.store, epic);
  return {
    epicKey: epic.key,
    stories,
    problems: problems.filter((p) => !FORM_PROBLEMS.includes(p.kind)),
    launch,
    progress: launch ? await progressOf(deps, launch) : null,
    limits: {
      maxRuns: NIGHT_LIMITS.maxRuns,
      maxTokens: NIGHT_LIMITS.maxTokens,
      maxUsd: NIGHT_LIMITS.maxUsd,
      maxHours: NIGHT_LIMITS.maxHours,
    },
  };
}

/** The epic's newest launch (the store lists the project's newest first). */
async function latestLaunch(store: NightLaunchStore, epic: Ticket): Promise<NightLaunch | null> {
  return (await store.listForProject(epic.projectId)).find((l) => l.epicId === epic.id) ?? null;
}

/** Story counts by where they stand and the spend since the launch started. */
export async function progressOf(
  deps: Pick<NightDeps, "tracker" | "runs">,
  launch: NightLaunch,
): Promise<z.infer<typeof NightProgress>> {
  const keys = new Set(launch.storyKeys);
  const stories = (await deps.tracker.listTickets(launch.projectId)).filter((t) => keys.has(t.key));
  const since = launch.startedAt ?? launch.createdAt;
  const counts = { total: launch.storyKeys.length, done: 0, running: 0, stopped: 0, waiting: 0 };
  const spend = { runs: 0, tokens: 0, estimatedUsd: 0, unknownRuns: 0 };
  for (const t of stories) {
    const runs = (await deps.runs.listForTicket(t.projectId, t.id)).filter(
      (r) => (r.createdAt ?? "") >= since,
    );
    const active = runs.some((r) => ACTIVE_RUN.has(r.status));
    if (t.stage === "done") counts.done++;
    else if (active) counts.running++;
    else if (t.needsAttention || t.stage === "cancelled") counts.stopped++;
    else counts.waiting++;
    for (const r of runs) {
      spend.runs++;
      spend.tokens += (r.tokensIn ?? 0) + (r.tokensOut ?? 0);
      if (r.costUsd !== null) spend.estimatedUsd += r.costUsd;
      else if (!ACTIVE_RUN.has(r.status)) spend.unknownRuns++;
    }
  }
  // A story key no longer under the project (moved or deleted) counts as waiting.
  counts.waiting += counts.total - stories.length;
  return { stories: counts, spend: { ...spend, estimatedUsd: round2(spend.estimatedUsd) } };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Starts a launch for the epic: refused with every problem while anything is open. */
export async function launchNight(
  deps: NightDeps,
  epic: Ticket,
  body: LaunchNightBody,
  actor: EventActor,
): Promise<NightLaunch> {
  await settleNight(deps, epic.projectId);
  return deps.nights.start(
    epic.projectId,
    { epicId: epic.id, budget: body.budget, stopAt: body.stopAt ?? null },
    actor,
  );
}

/** Stops the epic's running launch: no new agent tasks, in-flight ones finish. */
export async function stopNight(
  deps: NightDeps,
  epic: Ticket,
  actor: EventActor,
): Promise<NightLaunch> {
  const active = await settleNight(deps, epic.projectId);
  if (!active || active.epicId !== epic.id || active.status !== "running") {
    throw new WorkTrackerError("conflict", `${epic.key} has no running launch`);
  }
  const stopping = await deps.nights.stop(active.id, actor);
  // With nothing in flight the night is over at once; otherwise it ends once they finish.
  await settleNight(deps, epic.projectId);
  return (await deps.store.get(stopping.id)) ?? stopping;
}

const ErrorBody = z.object({ error: z.string(), details: z.array(z.string()).optional() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const secured = { security: [{ bearer: [] }] };
const TicketParams = z.object({
  projectId: z.string().regex(/^[a-z][a-z0-9]{0,9}$/),
  ticketId: z.uuid(),
});
const PATH = "/api/projects/{projectId}/tickets/{ticketId}/night";

const routes = {
  status: createRoute({
    ...secured,
    method: "get",
    path: PATH,
    request: { params: TicketParams },
    responses: {
      200: json(NightStatus, "The epic's launch checklist and its latest launch with progress"),
      404: json(ErrorBody, "Not found"),
    },
  }),
  launch: createRoute({
    ...secured,
    method: "post",
    path: PATH,
    request: {
      params: TicketParams,
      body: { content: { "application/json": { schema: LaunchNightBody } }, required: true },
    },
    responses: {
      200: json(NightLaunchBody, "The running launch"),
      403: json(ErrorBody, "Only the owner launches a night"),
      404: json(ErrorBody, "Not found"),
      409: json(ErrorBody, "Another launch is active in the project"),
      422: json(ErrorBody, "Something is open: every problem in `details`"),
    },
  }),
  stop: createRoute({
    ...secured,
    method: "post",
    path: `${PATH}/stop`,
    request: { params: TicketParams },
    responses: {
      200: json(NightLaunchBody, "Stopping: no new agent tasks, in-flight ones finish"),
      403: json(ErrorBody, "Only the owner stops a night"),
      404: json(ErrorBody, "Not found"),
      409: json(ErrorBody, "No running launch for this epic"),
    },
  }),
};

export function registerNightRoutes(app: OpenAPIHono<AuthEnv>, deps: NightDeps): void {
  const epicOf = async (projectId: string, ticketId: string) => {
    const epic = await deps.tracker.getTicket(projectId, ticketId);
    if (!epic) throw notFound("ticket", ticketId);
    return epic;
  };

  app.openapi(routes.status, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    return c.json(await readNightStatus(deps, await epicOf(projectId, ticketId)), 200);
  });

  app.openapi(routes.launch, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    const epic = await epicOf(projectId, ticketId);
    const launch = await launchNight(deps, epic, c.req.valid("json"), actorOf(c.get("identity")));
    return c.json(launch, 200);
  });

  app.openapi(routes.stop, async (c) => {
    const { projectId, ticketId } = c.req.valid("param");
    const epic = await epicOf(projectId, ticketId);
    return c.json(await stopNight(deps, epic, actorOf(c.get("identity"))), 200);
  });
}
