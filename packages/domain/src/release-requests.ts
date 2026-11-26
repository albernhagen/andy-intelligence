import {
  DEPLOYMENT_LIMITS,
  FINAL_RELEASE_REQUEST_STATUSES,
  RELEASE_REQUEST_LIMITS,
  WorkTrackerError,
  notFound,
  type CodeHost,
  type Deployment,
  type DeploymentStore,
  type EventActor,
  type Project,
  type ReleaseAction,
  type ReleaseRequest,
  type ReleaseRequestPatch,
  type ReleaseRequestStatus,
  type ReleaseRequestStore,
  type ReportedEnvironment,
  type WatchdogQueue,
  type WorkTracker,
} from "@andy/contracts";
import { REPORTING_WORKFLOWS } from "./deployment-reports";
import { DomainError } from "./errors";
import { requireCan } from "./permissions";

/**
 * Promote and rollback (AI-199: M6.12, ADR-0114, ADR-0160): the one service behind the owner's
 * routes and MCP tools. It decides what will serve, records a release request (the audit record
 * and the once-a-minute cap), starts the project's `release.yml` through the code host with the
 * request's id, and queues a check of how the run ended. The control plane holds no cloud
 * credential: the workflow's own deployer identity changes traffic.
 */

/** When the first run check is delivered after a dispatch; later ones follow at the same gap. */
export const RELEASE_CHECK_DELAY_MS = 45 * 60_000;
/** After this long from the request, a run still not finished is left alone (logged). */
export const RELEASE_CHECK_MAX_MS = 6 * 60 * 60_000;

export interface PromoteInput {
  projectId: string;
  /** A succeeded dev deployment's image digest; default the latest succeeded one. */
  digest?: string;
}

export interface RollbackInput {
  projectId: string;
  /** Default prod. */
  environment?: ReportedEnvironment;
  /** A succeeded deployment's revision; default the one before what serves now. */
  revision?: string;
}

export interface ReleaseResult {
  request: ReleaseRequest;
  /** What will serve afterwards, in one line. */
  summary: string;
}

/** What a check found; logged by the caller. */
export type ReleaseCheckOutcome =
  | "not_found"
  | "final"
  | "rescheduled"
  | "gave_up"
  | "cancelled"
  | "ended_unreported"
  | "never_dispatched";

export interface ReleaseServiceDeps {
  tracker: Pick<WorkTracker, "getProject">;
  deployments: Pick<DeploymentStore, "list">;
  requests: ReleaseRequestStore;
  /** The connected code host, or null when none is connected. */
  codeHost: () => Promise<CodeHost | null>;
  /** Null: no run checks (logged). */
  queue: Pick<WatchdogQueue, "scheduleCheck"> | null;
  now?: () => Date;
}

function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object = {}) {
  console.log(JSON.stringify({ severity, message, component: "release-requests", ...fields }));
}

const short = (digest: string) => digest.slice(0, 19);
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Why a project can't release at all, or null. */
export function releaseRefusal(
  project: Pick<Project, "key" | "deployKind" | "environments" | "repos">,
  action: ReleaseAction,
  environment: ReportedEnvironment,
): string | null {
  if (project.deployKind === "none") {
    return `project ${project.key} does not deploy (deploy kind none): set its deploy kind first`;
  }
  if (project.repos.length === 0) return `project ${project.key} has no repo`;
  if (project.environments === "prod-only") {
    if (action === "promote") {
      return `project ${project.key} is prod-only: there is no dev to promote from; roll back instead`;
    }
    if (environment === "dev") return `project ${project.key} is prod-only: it has no dev`;
  }
  return null;
}

/** The deployment a promote ships: the named digest's, or the newest succeeded dev one. */
export function promoteSource(
  dev: readonly Deployment[],
  digest: string | undefined,
): Deployment | string {
  const good = dev.filter((d) => d.status === "succeeded");
  if (digest === undefined) return good[0] ?? "nothing has succeeded in dev to promote";
  return (
    good.find((d) => d.imageDigest === digest) ??
    `no succeeded dev deployment has image digest ${digest}`
  );
}

/**
 * The deployment a rollback returns to (newest first input): the named revision's, or the newest
 * succeeded one whose revision differs from what serves now (the newest succeeded deployment).
 */
export function rollbackTarget(
  deployments: readonly Deployment[],
  environment: ReportedEnvironment,
  revision: string | undefined,
): Deployment | string {
  const good = deployments.filter((d) => d.status === "succeeded" && d.revision !== null);
  const serving = good[0];
  if (!serving) return `nothing has succeeded in ${environment} with a known revision`;
  if (revision !== undefined) {
    const named = good.find((d) => d.revision === revision);
    if (!named) return `no succeeded ${environment} deployment has revision ${revision}`;
    if (named.revision === serving.revision) return `${environment} already serves ${revision}`;
    return named;
  }
  return (
    good.find((d) => d.revision !== serving.revision) ??
    `no earlier succeeded revision in ${environment} to roll back to`
  );
}

/**
 * Whether a release workflow's start report belongs to `request` (ADR-0160): same project, kind,
 * environment and image digest, and not matched before. Null when it does; else why not.
 */
export function releaseRequestMismatch(
  request: ReleaseRequest | null,
  report: {
    projectId: string;
    kind: ReleaseAction;
    environment: ReportedEnvironment;
    imageDigest: string;
  },
): string | null {
  if (!request || request.projectId !== report.projectId) return "unknown release request";
  if (request.status !== "requested" && request.status !== "dispatched") {
    return `release request is ${request.status}`;
  }
  if (request.action !== report.kind) return `release request is a ${request.action}`;
  if (request.environment !== report.environment) {
    return `release request is for ${request.environment}`;
  }
  if (request.digest !== report.imageDigest) return "release request names another image digest";
  return null;
}

export class ReleaseService {
  private readonly now: () => Date;

  constructor(private readonly deps: ReleaseServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async promote(input: PromoteInput, actor: EventActor): Promise<ReleaseResult> {
    requireCan(actor, "release", input.projectId);
    const project = await this.releasable(input.projectId, "promote", "prod");
    const dev = await this.deps.deployments.list(project.id, "dev", DEPLOYMENT_LIMITS.maxPage);
    const source = promoteSource(dev, input.digest);
    if (typeof source === "string") {
      throw new DomainError(input.digest ? "invalid_field" : "not_releasable", source);
    }
    const prod = await this.deps.deployments.list(project.id, "prod", DEPLOYMENT_LIMITS.maxPage);
    const serving = prod.find((d) => d.status === "succeeded");
    if (serving?.imageDigest === source.imageDigest) {
      throw new DomainError("not_releasable", `prod already serves ${short(source.imageDigest)}`);
    }
    return this.submit(project, actor, {
      action: "promote",
      environment: "prod",
      digest: source.imageDigest,
      revision: null,
      sourceDeploymentId: source.id,
      summary: `prod will serve ${short(source.imageDigest)} (commit ${source.gitSha.slice(0, 7)}), promoted from dev`,
    });
  }

  async rollback(input: RollbackInput, actor: EventActor): Promise<ReleaseResult> {
    requireCan(actor, "release", input.projectId);
    const environment = input.environment ?? "prod";
    const project = await this.releasable(input.projectId, "rollback", environment);
    const recent = await this.deps.deployments.list(
      project.id,
      environment,
      DEPLOYMENT_LIMITS.maxPage,
    );
    const target = rollbackTarget(recent, environment, input.revision);
    if (typeof target === "string") {
      throw new DomainError(
        input.revision && !target.includes("already") ? "invalid_field" : "not_releasable",
        target,
      );
    }
    return this.submit(project, actor, {
      action: "rollback",
      environment,
      digest: target.imageDigest,
      revision: target.revision,
      sourceDeploymentId: target.id,
      summary: `${environment} will serve revision ${target.revision} (commit ${target.gitSha.slice(0, 7)}) again`,
    });
  }

  /** The project's recent release requests, newest first. */
  async list(projectId: string, limit?: number): Promise<ReleaseRequest[]> {
    const project = await this.deps.tracker.getProject(projectId);
    if (!project) throw notFound("project", projectId);
    return this.deps.requests.list(project.id, limit);
  }

  /**
   * The queue's delivery: how the request's run ended. A run that ended cancelled or without an
   * end report marks the request so the owner sees it; a run still going is checked again later.
   */
  async check(projectId: string, requestId: string): Promise<ReleaseCheckOutcome> {
    const request = await this.deps.requests.get(requestId);
    if (!request || request.projectId !== projectId) return "not_found";
    if (FINAL_RELEASE_REQUEST_STATUSES.includes(request.status)) return "final";
    const age = this.now().getTime() - Date.parse(request.createdAt);
    const project = await this.deps.tracker.getProject(projectId);
    const host = await this.deps.codeHost();
    const repo = project?.repos[0];
    if (request.runId === null) {
      if (age < RELEASE_CHECK_DELAY_MS) return this.recheck(request);
      return (await this.end(request, "dispatch_failed", "the workflow start was never confirmed"))
        ? "never_dispatched"
        : "final";
    }
    const run = host && repo ? await host.getWorkflowRun(repo, request.runId) : null;
    if (!run || run.status !== "completed") {
      if (age < RELEASE_CHECK_MAX_MS) return this.recheck(request);
      log("WARNING", "release run check gave up", { requestId, runId: request.runId, age });
      return "gave_up";
    }
    if (run.conclusion === "cancelled") {
      const ended = await this.end(
        request,
        "cancelled",
        "the run was cancelled before it reported an end (a deploy may have taken its place in the queue); ask again",
      );
      return ended ? "cancelled" : "final";
    }
    const ended = await this.end(
      request,
      "ended_unreported",
      `the run ended ${run.conclusion ?? "without a conclusion"} without reporting an end`,
    );
    return ended ? "ended_unreported" : "final";
  }

  private async releasable(
    projectId: string,
    action: ReleaseAction,
    environment: ReportedEnvironment,
  ): Promise<Project> {
    const project = await this.deps.tracker.getProject(projectId);
    if (!project) throw notFound("project", projectId);
    const refusal = releaseRefusal(project, action, environment);
    if (refusal) {
      log("WARNING", "release refused", { projectId, action, environment, reason: refusal });
      throw new DomainError("not_releasable", refusal);
    }
    return project;
  }

  private async submit(
    project: Project,
    actor: EventActor,
    plan: {
      action: ReleaseAction;
      environment: ReportedEnvironment;
      digest: string;
      revision: string | null;
      sourceDeploymentId: string;
      summary: string;
    },
  ): Promise<ReleaseResult> {
    const host = await this.deps.codeHost();
    if (!host) throw new DomainError("code_host_unavailable", "the code host is not connected");
    const repo = project.repos[0]!;
    const at = this.now().toISOString();
    const made = await this.deps.requests.create(
      {
        projectId: project.id,
        action: plan.action,
        environment: plan.environment,
        digest: plan.digest,
        revision: plan.revision,
        sourceDeploymentId: plan.sourceDeploymentId,
        actor,
        createdAt: at,
        status: "requested",
        updatedAt: at,
      },
      RELEASE_REQUEST_LIMITS.minGapMs,
    );
    if (!("created" in made)) {
      log("WARNING", "release refused", { projectId: project.id, reason: "rate cap", actor });
      throw new DomainError(
        "rate_limited",
        `one release request per project per minute: try again after ${made.tooSoonUntil}`,
      );
    }
    const request = made.created;
    const audit = {
      projectId: project.id,
      requestId: request.id,
      action: plan.action,
      environment: plan.environment,
      digest: plan.digest,
      revision: plan.revision,
      actor,
      repo,
    };
    log("INFO", "release requested", audit);

    let dispatched;
    try {
      dispatched = await host.dispatchWorkflow(repo, REPORTING_WORKFLOWS.release, {
        action: plan.action,
        environment: plan.environment,
        digest: plan.action === "promote" ? plan.digest : "",
        revision: plan.revision ?? "",
        request: request.id,
      });
    } catch (err) {
      const reason = dispatchRefusal(repo, err);
      await this.end(request, "dispatch_failed", reason);
      log("ERROR", "release dispatch failed", { ...audit, error: errorText(err) });
      throw new DomainError("dispatch_failed", reason);
    }
    if (!dispatched) {
      const reason = `the code host app is not installed on ${repo}; nothing changed`;
      await this.end(request, "dispatch_failed", reason);
      log("ERROR", "release dispatch failed", { ...audit, error: reason });
      throw new DomainError("dispatch_failed", reason);
    }
    const stored = await this.recordRun(request.id, dispatched.id, dispatched.url);
    log("INFO", "release dispatched", { ...audit, runId: dispatched.id });
    await this.recheck(stored);
    return { request: stored, summary: plan.summary };
  }

  /**
   * Keeps the run on the request. Normally `requested` → `dispatched`; if the workflow already
   * reported its start, the run is added and the status kept.
   */
  private async recordRun(requestId: string, runId: string, runUrl: string) {
    const updatedAt = this.now().toISOString();
    try {
      return await this.deps.requests.update(
        requestId,
        { status: "dispatched", runId, runUrl, updatedAt },
        ["requested"],
      );
    } catch (err) {
      if (!(err instanceof WorkTrackerError && err.code === "conflict")) throw err;
      const current = await this.deps.requests.get(requestId);
      if (!current) throw err;
      return this.deps.requests.update(
        requestId,
        { status: current.status, runId, runUrl, updatedAt },
        [current.status],
      );
    }
  }

  /** Ends the request unless something else ended it first; true when this call did. */
  private async end(
    request: ReleaseRequest,
    status: ReleaseRequestStatus,
    error: string,
  ): Promise<boolean> {
    const patch: ReleaseRequestPatch = { status, error, updatedAt: this.now().toISOString() };
    try {
      await this.deps.requests.update(request.id, patch, [request.status]);
      log(status === "cancelled" ? "WARNING" : "ERROR", "release request ended", {
        requestId: request.id,
        projectId: request.projectId,
        status,
        error,
      });
      return true;
    } catch (err) {
      if (err instanceof WorkTrackerError && err.code === "conflict") return false;
      throw err;
    }
  }

  private async recheck(request: ReleaseRequest): Promise<"rescheduled"> {
    if (!this.deps.queue) {
      log("WARNING", "release run check not queued: no watchdog queue", { requestId: request.id });
      return "rescheduled";
    }
    const at = new Date(this.now().getTime() + RELEASE_CHECK_DELAY_MS).toISOString();
    try {
      await this.deps.queue.scheduleCheck({
        kind: "release",
        projectId: request.projectId,
        requestId: request.id,
        at,
      });
    } catch (err) {
      log("ERROR", "release run check not queued", {
        requestId: request.id,
        error: errorText(err),
      });
    }
    return "rescheduled";
  }
}

/** What to tell the owner when the code host refuses to start the workflow. */
function dispatchRefusal(repo: string, err: unknown): string {
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 403) {
    return `the code host app may not start workflows on ${repo} (it needs actions: write); ask Andy, nothing changed`;
  }
  if (status === 404 || status === 422) {
    return `${repo} has no ${REPORTING_WORKFLOWS.release} that can be started on its default branch; nothing changed`;
  }
  return `the code host refused to start ${REPORTING_WORKFLOWS.release} on ${repo}; nothing changed`;
}
