import type { OpenAPIHono } from "@hono/zod-openapi";
import { ClaudeCodeActionsExecutor } from "@andy/github";
import {
  MilestoneService,
  BuildDispatcher,
  SyncRuns,
  ProjectService,
  RefineDispatcher,
  RunService,
  RunnerService,
  LocalClaims,
  ConfigProposals,
  ConfigRevert,
  DigestReader,
  DigestSummaryResults,
  DigestSummaryService,
  subscriptionQuotaLevels,
  CLAUDE_SUB_THRESHOLDS,
  QuotaClearer,
  lowestThresholds,
  BriefService,
  IdeateService,
  ProjectPlanService,
  ProjectTaskResults,
  TicketService,
  WaitingMergesReader,
  WhatsNewReader,
  EmailNotifications,
  wakeAfterRunEnd,
  notifyOnNeedsYou,
  NightLaunches,
  EpicBranches,
  MorningPullRequests,
  MorningReports,
  MorningSteps,
  ProjectReadCache,
  TicketSnapshots,
  ProjectTickets,
  RoutingSettings,
  GlobalSpendCaps,
  SpendAlerts,
  SpendGate,
  NO_PRICES,
  BoardReader,
  WorkReader,
  DashboardReader,
  DoraReader,
  RoadmapReader,
  bumpOnWrite,
  type EpicBranchOpener,
} from "@andy/domain";
import {
  type EventActor,
  type NightLaunchStore,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import type { AppDeps } from "./app";
import type { AuthEnv } from "./auth";
import { noReviewFindings } from "./config-proposals";
import { ConnectedCodeHost, GitHubConnection, gitHubCodeHost } from "./github/connection";
import { BaselineProposer } from "./github/registration";
import { DirectExecutor } from "./direct-executor";
import { actionsTokenVerifier, type ActionsTokenVerifier } from "./github/token";
import type { ToolServices } from "./mcp/tools";
import type { NightDeps } from "./night";
import { measureReads, meterReads } from "./read-meter";
import { runnerCredentials } from "./runners";
import { OpenRouterGateway } from "./openrouter";
import { PullRequestMerger } from "./merge";
import { SetupChecklistReader } from "./setup";
import { SpendSettingsService } from "./spend";

/**
 * The domain services every route module and MCP tool share, built once per app (one
 * TicketService for REST, MCP and webhooks: all get the same ticket rules). Field names match
 * `ToolDeps`, so the MCP endpoint takes this object as it is. A new service is one field here
 * (and in `ToolDeps` when tools use it); its routes and tools register from their own modules
 * (AI-145).
 */
export interface Services extends Required<ToolServices> {
  /** The app's deps; `tracker` writes through the email hook when email is configured. */
  deps: AppDeps;
  now: () => Date;
  connection: GitHubConnection | null;
  runners: RunnerService | null;
  claims: LocalClaims | null;
  syncer: SyncRuns;
  dispatchNext: (projectId: string, wakeWaiters?: boolean) => Promise<unknown>;
  /** The Actions OIDC verifier for CI callbacks; null without the GitHub App. */
  verifyActionsToken: ActionsTokenVerifier | null;
  /** Unchanged board and ticket-list polls served per project version (AI-222); null without versions. */
  readCache: ProjectReadCache | null;
  /** Single-call steps on a `direct` route (AI-258); null without a spend ledger. */
  direct: DirectExecutor | null;
  snapshots: TicketSnapshots | null;
}

/** A module's routes: registered from its own file and listed once in `public-routes.ts` or `api-routes.ts`. */
export type RouteModule = (app: OpenAPIHono<AuthEnv>, services: Services) => void;

/** The stores whose reads the read meter counts (AI-315). */
/**
 * Each metered store's read methods (AI-315), listed so a write is never counted and a new read
 * isn't missed: `read-meter.test.ts` checks the lists against every store's methods.
 */
export const METERED_READS = {
  tracker: [
    "getProject",
    "listProjects",
    "getTicket",
    "listTickets",
    "listTicketsChangedSince",
    "getTicketByKey",
    "countByStage",
    "listEvents",
    "getLatestPullRequest",
    "getQuestion",
    "listQuestions",
  ],
  runs: ["get", "listForTicket", "listActive", "listEndedBetween", "countCreatedSince"],
  runners: ["get", "list", "findBySecretHash", "getRunToken"],
  configChanges: [
    "get",
    "listForProject",
    "listGlobal",
    "listPending",
    "latestDecision",
    "getLookupCursor",
  ],
  reviewFindings: ["recent"],
  releaseNotes: ["get", "listForProject"],
  milestones: ["list", "get"],
  quota: ["latest", "clearsSince"],
  nightLaunches: ["get", "listForProject", "findActive"],
  deployments: ["get", "list", "latestGood"],
  routing: ["getGlobal", "getProject"],
  spendLedger: ["get", "totals", "totalsByProvider"],
  spendCapsStore: ["getGlobal"],
  spendNotices: ["get"],
  projectVersions: ["get"],
} satisfies { [K in keyof AppDeps]?: readonly (keyof NonNullable<AppDeps[K]> & string)[] };

/** `deps` with each store's reads counted per request and per dispatch (AI-315). */
function metered(deps: AppDeps): AppDeps {
  const out: Record<string, unknown> = { ...deps };
  for (const [key, reads] of Object.entries(METERED_READS)) {
    const store = deps[key as keyof typeof METERED_READS];
    if (store) out[key] = meterReads(store, reads as never);
  }
  return out as unknown as AppDeps;
}

export function createServices(raw: AppDeps): Services {
  const input = metered(raw);
  // AI-77: with email configured, every service below writes through the tracker's email hook.
  const email = input.email
    ? new EmailNotifications({ tracker: input.tracker, ...input.email })
    : null;
  const notified = email
    ? { ...input, tracker: notifyOnNeedsYou(input.tracker, (t) => email.ticketNeedsYou(t)) }
    : input;
  // AI-222: every write bumps its project's counter, so cached board and list reads stay fresh.
  const versions = notified.projectVersions;
  const deps = versions
    ? { ...notified, ...bumpOnWrite(notified.tracker, notified.runs, versions) }
    : notified;
  const readCache = versions ? new ProjectReadCache(versions) : null;
  // AI-317: the board and ticket list refresh from changed tickets, not the whole project.
  const snapshots = readCache ? new TicketSnapshots(deps.tracker) : null;
  // AI-318: the readers that need every ticket read them through the same snapshots.
  const tickets = new ProjectTickets(deps.tracker, versions ?? null, snapshots);
  // Board reads served through the read cache: board polls, work lists and roadmaps (ADR-0126).
  const board = new BoardReader(deps.tracker, deps.runs, readCache, snapshots);

  const github = deps.github;
  const now = github?.now ?? (() => new Date());
  // AI-276: the global spend caps, read by project cap checks, the spend gate and the settings.
  const globalSpendCaps = new GlobalSpendCaps(
    deps.spendCapsStore ?? null,
    deps.configChanges ?? null,
    now,
  );
  const connection = github
    ? new GitHubConnection(github.connections, github.codeHostFor ?? gitHubCodeHost, () =>
        now().getTime(),
      )
    : null;

  // Runs dispatch through the GitHub App; without it, starting a run is refused (503).
  // The dispatchers start the next waiting run after each report or watchdog end, ticket
  // create, last answer, move to Ready and switch turned on: a build first (ADR-0063, projects
  // with autoBuild), else a refine (ADR-0054). Projects waiting on the global cap go first,
  // then builds start up to the caps (ADR-0079). `next` and `wakeGlobalCapWaiters` never throw.
  // When a run ends at the global cap, `wakeAfterRunEnd` offers the slot to other projects in
  // `dispatchOrder` (AI-91), syncs and refines too, until it's taken; the freeing project goes last.
  // Local runners (ADR-0089): claims start runs through the same dispatchers and RunService.
  const runners = deps.runners
    ? new RunnerService(deps.runners, deps.tracker, runnerCredentials, now)
    : null;
  const runnerPresence = runners ? (projectId: string) => runners.presentFor(projectId) : null;
  // AI-134: plan-project and ideate results are stored by the plan and ideate services, built
  // below (they need the ticket service, which needs `runs`); a report only calls these later.
  const plansLater: Pick<ProjectPlanService, "proposeFromRun"> = {
    proposeFromRun: (run, output) => plans.proposeFromRun(run, output),
  };
  const ideasLater: Pick<IdeateService, "submitFromRun"> = {
    submitFromRun: (run, output) => ideate.submitFromRun(run, output),
  };
  const projectTasks: ProjectTaskResults = new ProjectTaskResults(plansLater, ideasLater);
  // AI-323: stores and fails digest summaries from summarize runs' reports and ends.
  const summaryResults =
    deps.digestSummaries && deps.releaseNotes
      ? new DigestSummaryResults(deps.digestSummaries, now)
      : null;
  // AI-257: spend notices (80% of a cap, a stop) go to the Needs-you email when it is on, else
  // to the logs; their dedupe and daily cap live in the stored notice ledger.
  const spendAlerts = deps.spendNotices
    ? new SpendAlerts({
        tracker: deps.tracker,
        ledger: deps.spendNotices,
        notifier: deps.email?.notifier ?? null,
        appUrl:
          deps.email?.appUrl ??
          (deps.publicHost ? `https://${deps.publicHost}` : "http://localhost"),
        now,
      })
    : null;
  // AI-248: no price source yet (M10.5), so the gate refuses every pay_per_use start. Caps:
  // the defaults, narrowed by the project's own (AI-249).
  const spendGate = deps.spendLedger
    ? new SpendGate(
        deps.spendLedger,
        NO_PRICES,
        async (id) => ({
          // Unreadable global caps throw here, and the gate starts no paid task (fail closed).
          global: await globalSpendCaps.caps(),
          project: (await deps.tracker.getProject(id))?.spendCaps ?? null,
        }),
        now,
        spendAlerts ? (event) => spendAlerts.handle(event) : null,
      )
    : null;
  // AI-258/AI-268: single-call steps routed to `direct`. The gateway has no key until AI-266:
  // M10.15, and no price source exists, so every direct call fails closed for now.
  const direct = spendGate
    ? new DirectExecutor(
        deps.runs,
        new OpenRouterGateway({ readKey: async () => null }),
        spendGate,
        NO_PRICES,
        deps.routing ?? null,
        now,
      )
    : null;
  const runs = new RunService(
    deps.tracker,
    deps.runs,
    connection ? new ClaudeCodeActionsExecutor(new ConnectedCodeHost(connection)) : null,
    now,
    deps.watchdog?.queue ?? null,
    async (projectId) => runEnded(projectId),
    connection ? new ConnectedCodeHost(connection) : null,
    runnerPresence,
    deps.nightLaunches ?? null,
    null,
    deps.routing ?? null,
    spendGate,
    projectTasks,
    summaryResults,
  );
  const refiner = new RefineDispatcher(deps.tracker, deps.runs, runs, now, deps.milestones ?? null);
  // AI-124/AI-125: when a launch ends, its morning PR opens (or an empty epic branch goes),
  // then the morning report goes on the epic, with or without GitHub. One instance for both
  // places a launch ends: `NightLaunches.end` (stop, stop time) and the build dispatcher (done,
  // a budget limit). `flag` is looked up when a launch ends: `service` is built further down.
  const flagger: Pick<TicketService, "flag"> = {
    flag: (projectId: string, ticketId: string, actor: EventActor): Promise<Ticket> =>
      service.flag(projectId, ticketId, actor),
  };
  const morning = deps.nightLaunches
    ? new MorningSteps(
        connection && deps.github
          ? new MorningPullRequests(
              deps.tracker,
              deps.runs,
              new ConnectedCodeHost(connection),
              deps.github.publicUrl,
              flagger,
            )
          : null,
        new MorningReports(
          deps.tracker,
          deps.runs,
          flagger,
          deps.github?.publicUrl ?? "",
          deps.reviewFindings ?? null,
        ),
      )
    : null;
  // AI-279: with the launch store and the morning steps, dispatch holds a launch's stories at
  // its budget or once stopped, and ends the launch when its stories finish or a limit is hit.
  const builder = new BuildDispatcher(
    deps.tracker,
    deps.runs,
    runs,
    now,
    deps.quota ?? null,
    deps.nightLaunches ?? null,
    morning,
    deps.milestones ?? null,
  );
  // AI-72 (ADR-0083): queued sync runs go first, so open PRs catch up with main before new work.
  const syncer = new SyncRuns(
    deps.tracker,
    deps.runs,
    runs,
    connection ? new ConnectedCodeHost(connection) : null,
    now,
    deps.quota ?? null,
  );
  const dispatchOnce = async (projectId: string, wakeWaiters: boolean) => {
    // AI-75 (ADR-0087): held gaps are asked first, as the question caps allow; no run needed.
    await refiner.askHeld(projectId);
    await syncer.next(projectId);
    if (wakeWaiters) await builder.wakeGlobalCapWaiters(projectId);
    return (await builder.next(projectId)) ?? (await refiner.next(projectId));
  };
  // AI-315: one line per dispatch event with the documents it read (also counted in its request).
  const dispatchNext = async (projectId: string, wakeWaiters = true) => {
    const { value, reads } = await measureReads(() => dispatchOnce(projectId, wakeWaiters));
    console.log(
      JSON.stringify({
        severity: "INFO",
        message: "dispatch reads",
        component: "read-meter",
        projectId,
        reads,
      }),
    );
    return value;
  };
  const runEnded = async (projectId: string) => {
    await wakeAfterRunEnd({
      freedBy: projectId,
      listProjects: () => deps.tracker.listProjects(),
      globalActive: async () => (await runs.activeCounts(projectId)).global,
      // One project's failure must not keep the slot from the projects after it.
      dispatch: (id, wakeWaiters) =>
        dispatchNext(id, wakeWaiters).then(
          () => undefined,
          (err: unknown) =>
            console.error(
              JSON.stringify({
                severity: "ERROR",
                message: "dispatch after a run ended failed",
                projectId: id,
                error: String(err),
              }),
            ),
        ),
    });
  };
  const service = new TicketService(
    deps.tracker,
    runs,
    dispatchNext,
    now,
    runnerPresence,
    deps.routing ?? null,
    tickets,
  );
  const claims = runners
    ? new LocalClaims(
        deps.tracker,
        deps.runs,
        runs,
        runners,
        builder,
        refiner,
        deps.watchdog?.queue ?? null,
        now,
      )
    : null;

  // M4.17: the night launch step; absent without a launch store (routes and tools both).
  const night: NightDeps | null = deps.nightLaunches
    ? {
        // AI-122: with GitHub connected, a launch opens its `epic/<KEY>` branch for the stories.
        nights: new NightLaunches(
          deps.nightLaunches,
          deps.tracker,
          runs,
          now,
          undefined,
          connection ? connectedEpicBranches(connection, deps.tracker, deps.nightLaunches) : null,
          morning,
          deps.milestones ?? null,
        ),
        store: deps.nightLaunches,
        tracker: deps.tracker,
        runs: deps.runs,
        plans: runs,
        now,
      }
    : null;

  const projectHost = connection ? new ConnectedCodeHost(connection) : null;
  // AI-113: a registered repo gets its baseline PR through the App (none without a code host).
  const baseline = projectHost ? new BaselineProposer(projectHost, deps.tracker, now) : null;
  const projects = new ProjectService(
    deps.tracker,
    projectHost,
    dispatchNext,
    now,
    deps.configChanges ?? null,
    undefined,
    () => globalSpendCaps.caps(),
    baseline ? (project) => baseline.onProjectRegistered(project) : null,
  );
  // AI-74: a clear wakes every project, as a settings change wakes one. AI-261: it clears at
  // the lowest claude-sub pause level any project's routing dispatches under.
  const quota = new QuotaClearer(
    deps.quota ?? null,
    now,
    async () => {
      for (const p of await deps.tracker.listProjects()) await dispatchNext(p.id);
    },
    async () => {
      const projects = await deps.tracker.listProjects();
      const routings = await Promise.all(projects.map((p) => runs.routingOf(p.id)));
      return lowestThresholds("claude-sub", routings, CLAUDE_SUB_THRESHOLDS);
    },
  );
  const digest = new DigestReader(deps.tracker, deps.runs, deps.quota ?? null, now, tickets);
  // AI-323 (ADR-0137): Andy's first digest read after a day ends starts its summary task.
  const digestSummaries =
    deps.digestSummaries && deps.releaseNotes
      ? new DigestSummaryService({
          store: deps.digestSummaries,
          tracker: deps.tracker,
          releaseNotes: deps.releaseNotes,
          tickets,
          milestones: deps.milestones ?? null,
          digest,
          starter: runs,
          quotaLevels: async (projectId) =>
            subscriptionQuotaLevels(deps.quota ?? null, await runs.routingOf(projectId), now()),
          now,
        })
      : null;
  const brief = new BriefService(
    deps.tracker,
    connection ? new ConnectedCodeHost(connection) : null,
    now,
  );
  const ideate = new IdeateService(
    deps.tracker,
    service,
    connection ? new ConnectedCodeHost(connection) : null,
    now,
  );
  const plans = new ProjectPlanService(
    deps.tracker,
    service,
    now,
    email ? (id, plan) => email.planNeedsYou(id, plan.proposal.milestones.length) : undefined,
  );
  const configProposals = deps.configChanges
    ? new ConfigProposals(
        deps.tracker,
        deps.reviewFindings ?? noReviewFindings,
        deps.configChanges,
        now,
      )
    : null;
  // AI-159: the What's new read; absent without a release-note store (route and tool both).
  const whatsNew = deps.releaseNotes
    ? new WhatsNewReader(deps.tracker, deps.releaseNotes, tickets)
    : null;
  // AI-239: routing settings; each save is logged when the change log is configured.
  const routing = deps.routing
    ? new RoutingSettings(deps.routing, deps.tracker, deps.configChanges ?? null, now)
    : null;
  // AI-304: milestones (ADR-0131); each write is logged when the change log is configured.
  const milestoneService = deps.milestones
    ? new MilestoneService(deps.tracker, deps.milestones, deps.configChanges ?? null, now)
    : null;
  // AI-275: a routing change in a project's log reverts through routing settings; AI-304: a
  // milestone change through the milestone service.
  const configRevert = deps.configChanges
    ? new ConfigRevert(deps.tracker, projects, deps.configChanges, now, routing, milestoneService)
    : null;

  return {
    deps,
    now,
    connection,
    runners,
    claims,
    syncer,
    dispatchNext,
    verifyActionsToken:
      github && connection
        ? (github.verifyActionsToken ?? actionsTokenVerifier(github.publicUrl))
        : null,
    tracker: deps.tracker,
    service,
    runs,
    projects,
    digest,
    notifyEmail: email,
    quota,
    brief,
    ideate,
    plans,
    configProposals,
    configRevert,
    routing,
    milestoneService,
    night,
    readCache,
    direct,
    snapshots,
    tickets,
    setup: new SetupChecklistReader(
      deps.tracker,
      connection ? new ConnectedCodeHost(connection) : null,
    ),
    spend: new SpendSettingsService(
      projects,
      async (id) => (await deps.tracker.getProject(id))?.spendCaps ?? null,
      deps.spendLedger ?? null,
      now,
      globalSpendCaps,
    ),
    globalSpendCaps,
    // AI-296: the board route and MCP `board` share one reader (cache and snapshots).
    board,
    // AI-198, AI-193: each project's board through the same read cache as board polls.
    work: new WorkReader(deps.tracker, board),
    roadmap: new RoadmapReader(deps.tracker, board, deps.milestones ?? null),
    whatsNew,
    // AI-218: PRs the merge mode leaves for Andy; release notes read from the connected host.
    waitingMerges: new WaitingMergesReader(
      deps.tracker,
      deps.runs,
      connection ? new ConnectedCodeHost(connection) : null,
      tickets,
      now,
    ),
    digestSummaries,
    // AI-220: MCP `merge_pr`, through the connected host with the gate's findings source.
    merges: new PullRequestMerger(
      deps.tracker,
      connection ? new ConnectedCodeHost(connection) : null,
      deps.reviewFindings ?? null,
      now,
    ),
    milestones: deps.milestones ?? null,
    // AI-295: one reader each for the Dashboards routes and MCP `dashboard`.
    dashboard: new DashboardReader(deps.tracker, deps.runs, tickets),
    dora: new DoraReader(deps.tracker, deps.deployments ?? null, now),
    publicUrl: deps.mcp?.publicUrl ?? null,
  };
}

/**
 * AI-122 epic branches, once GitHub is connected: before setup (or in local dev) a launch opens
 * none and its stories build on the default branch, as `NightLaunch.epicBranch` allows.
 */
function connectedEpicBranches(
  connection: GitHubConnection,
  tracker: WorkTracker,
  launches: NightLaunchStore,
): EpicBranchOpener {
  const branches = new EpicBranches(tracker, new ConnectedCodeHost(connection), launches);
  return {
    open: async (projectId, epic) =>
      (await connection.codeHost()) ? branches.open(projectId, epic) : null,
  };
}
