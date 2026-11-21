import type { OpenAPIHono } from "@hono/zod-openapi";
import { ClaudeCodeActionsExecutor } from "@andy/github";
import {
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
  QuotaClearer,
  BriefService,
  IdeateService,
  ProjectPlanService,
  TicketService,
  EmailNotifications,
  wakeAfterRunEnd,
  notifyOnNeedsYou,
  NightLaunches,
  EpicBranches,
  MorningPullRequests,
  ProjectReadCache,
  RoutingSettings,
  GlobalSpendCaps,
  SpendGate,
  NO_PRICES,
  BoardReader,
  WorkReader,
  bumpOnWrite,
  type EpicBranchOpener,
} from "@andy/domain";
import { type NightLaunchStore, type WorkTracker } from "@andy/contracts";
import type { AppDeps } from "./app";
import type { AuthEnv } from "./auth";
import { noReviewFindings } from "./config-proposals";
import { ConnectedCodeHost, GitHubConnection, gitHubCodeHost } from "./github/connection";
import { actionsTokenVerifier, type ActionsTokenVerifier } from "./github/token";
import type { ToolServices } from "./mcp/tools";
import type { NightDeps } from "./night";
import { runnerCredentials } from "./runners";
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
}

/** A module's routes: registered from its own file and listed once in `public-routes.ts` or `api-routes.ts`. */
export type RouteModule = (app: OpenAPIHono<AuthEnv>, services: Services) => void;

export function createServices(input: AppDeps): Services {
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
    // AI-248: no price source yet (M10.5), so the gate refuses every pay_per_use start. Caps:
    // the defaults, narrowed by the project's own (AI-249).
    deps.spendLedger
      ? new SpendGate(deps.spendLedger, NO_PRICES, async (id) => ({
          // Unreadable global caps throw here, and the gate starts no paid task (fail closed).
          global: await globalSpendCaps.caps(),
          project: (await deps.tracker.getProject(id))?.spendCaps ?? null,
        }))
      : null,
  );
  const refiner = new RefineDispatcher(deps.tracker, deps.runs, runs, now);
  const builder = new BuildDispatcher(deps.tracker, deps.runs, runs, now, deps.quota ?? null);
  // AI-72 (ADR-0083): queued sync runs go first, so open PRs catch up with main before new work.
  const syncer = new SyncRuns(
    deps.tracker,
    deps.runs,
    runs,
    connection ? new ConnectedCodeHost(connection) : null,
    now,
    deps.quota ?? null,
  );
  const dispatchNext = async (projectId: string, wakeWaiters = true) => {
    // AI-75 (ADR-0087): held gaps are asked first, as the question caps allow; no run needed.
    await refiner.askHeld(projectId);
    await syncer.next(projectId);
    if (wakeWaiters) await builder.wakeGlobalCapWaiters(projectId);
    return (await builder.next(projectId)) ?? (await refiner.next(projectId));
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
  const service = new TicketService(deps.tracker, runs, dispatchNext, now, runnerPresence);
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
          // AI-124: when a launch ends, its morning PR opens (or an empty epic branch goes).
          connection && deps.github
            ? new MorningPullRequests(
                deps.tracker,
                deps.runs,
                new ConnectedCodeHost(connection),
                deps.github.publicUrl,
                service,
              )
            : null,
        ),
        store: deps.nightLaunches,
        tracker: deps.tracker,
        runs: deps.runs,
        plans: runs,
        now,
      }
    : null;

  const projects = new ProjectService(
    deps.tracker,
    connection ? new ConnectedCodeHost(connection) : null,
    dispatchNext,
    now,
    deps.configChanges ?? null,
    undefined,
    () => globalSpendCaps.caps(),
  );
  // AI-74: a clear wakes every project, as a settings change wakes one.
  const quota = new QuotaClearer(deps.quota ?? null, now, async () => {
    for (const p of await deps.tracker.listProjects()) await dispatchNext(p.id);
  });
  const digest = new DigestReader(deps.tracker, deps.runs, deps.quota ?? null, now);
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
  // AI-239: routing settings; each save is logged when the change log is configured.
  const routing = deps.routing
    ? new RoutingSettings(deps.routing, deps.tracker, deps.configChanges ?? null, now)
    : null;
  // AI-275: a routing change in a project's log reverts through routing settings.
  const configRevert = deps.configChanges
    ? new ConfigRevert(deps.tracker, projects, deps.configChanges, now, routing)
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
    night,
    readCache,
    spend: new SpendSettingsService(
      projects,
      async (id) => (await deps.tracker.getProject(id))?.spendCaps ?? null,
      deps.spendLedger ?? null,
      now,
      globalSpendCaps,
    ),
    globalSpendCaps,
    // AI-198: each project's board through the same read cache as board polls.
    work: new WorkReader(deps.tracker, new BoardReader(deps.tracker, deps.runs, readCache)),
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
