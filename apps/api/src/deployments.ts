import {
  DEPLOYMENT_LIMITS,
  Deployment,
  DeploymentStartReport,
  WorkTrackerError,
  type DeploymentStore,
  type Project,
} from "@andy/contracts";
import {
  REPORTING_WORKFLOWS,
  mayFinish,
  planStart,
  releaseSource,
  reportingWorkflow,
  reportingWorkflowRef,
  type ReportingWorkflow,
} from "@andy/domain";
import { z } from "@hono/zod-openapi";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AuthEnv } from "./auth";
import type { ActionsClaims, ActionsTokenVerifier } from "./github/token";
import { RepoIndex } from "./github/webhooks";
import { FixedWindowLimiter } from "./mcp/rate-limit";
import type { RouteModule } from "./services";

/**
 * Deployment reports from deploy and release workflows (AI-180: M6.4, AI-190: M6.11; ADR-0114).
 * The workflow proves who it is with its GitHub Actions OIDC token, like the run callbacks
 * (ADR-0019): only a registered, enabled project's `deploy.yml` or `release.yml` on `main` is
 * accepted, and every other caller gets 403 with nothing recorded. The token, not the body, says
 * which repo and workflow; the body adds what the token can't know (image digest, environment,
 * kind, url and request at the start; status and revision at the end). Who may report which kind:
 * `@andy/domain` `deployment-reports`.
 */

export const DEPLOYMENTS_PATH = "/deployments";
export const DEPLOYMENT_FINISH_PATH = "/deployments/:deploymentId/finish";
/** The workflow files that may report (paths under `.github/workflows/`). */
export const DEPLOY_WORKFLOW = REPORTING_WORKFLOWS.deploy;
export const RELEASE_WORKFLOW = REPORTING_WORKFLOWS.release;
/** Verified reports per instance per minute (max 2 instances; ADR-0028). A deploy sends two. */
export const DEPLOYMENT_REPORT_RATE_LIMIT = 30;
/** Report bodies are a few fields; anything larger is refused before parsing. */
export const DEPLOYMENT_REPORT_MAX_BYTES = 1024;

/** The repo's own deploy workflow on `main`. */
export function deployWorkflowRef(repository: string): string {
  return reportingWorkflowRef(repository, "deploy");
}

/** The repo's own release workflow on `main` (promote and rollback). */
export function releaseWorkflowRef(repository: string): string {
  return reportingWorkflowRef(repository, "release");
}

const FinishBody = z.strictObject({
  status: z.enum(["succeeded", "failed"]),
  revision: Deployment.shape.revision.unwrap().unwrap().optional(),
});
const DeploymentId = Deployment.shape.id;
const GitSha = Deployment.shape.gitSha;

function log(severity: "INFO" | "WARNING", message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ severity, message, component: "deployment-callback", ...fields }));
}

export interface DeploymentCallbackDeps {
  deployments: DeploymentStore;
  verify: ActionsTokenVerifier;
  /** The project a repo is registered to, or null (cached by the caller). */
  registeredProject: (repo: string) => Promise<Project | null>;
  /**
   * After a finish is recorded (AI-188: M6.7): the verification run acts on a deploy to the
   * project's first environment. Never throws; the answer doesn't wait on its outcome's success.
   */
  onFinished?: (deployment: Deployment, project: Project) => Promise<unknown>;
  now?: () => Date;
}

type Caller = {
  project: Project;
  sha: string;
  workflow: ReportingWorkflow;
  claims: ActionsClaims;
};

export function registerDeploymentCallbacks(
  app: Hono<AuthEnv>,
  deps: DeploymentCallbackDeps,
): void {
  const now = deps.now ?? (() => new Date());
  const limiter = new FixedWindowLimiter(DEPLOYMENT_REPORT_RATE_LIMIT, 60_000, () =>
    now().getTime(),
  );

  /** The verified caller, or the status to answer: 401 bad token, 403 not a reporting workflow. */
  const authenticate = async (authorization: string | undefined): Promise<Caller | 401 | 403> => {
    const jwt = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
    let claims: ActionsClaims;
    try {
      if (!jwt) throw new Error("no bearer token");
      claims = await deps.verify(jwt);
    } catch {
      log("WARNING", "deployment report token rejected");
      return 401;
    }
    const refuse = (reason: string) => {
      log("WARNING", "deployment report refused", {
        reason,
        repository: claims.repository,
        workflow_ref: claims.workflow_ref,
      });
      return 403 as const;
    };
    const workflow = reportingWorkflow(claims.repository, claims.workflow_ref);
    if (!workflow) return refuse("not the repo's deploy or release workflow on main");
    if (!claims.sha || !GitSha.safeParse(claims.sha).success)
      return refuse("token has no commit sha");
    const project = await deps.registeredProject(claims.repository);
    if (!project?.enabled) return refuse("repo is not registered to an enabled project");
    return { project, sha: claims.sha, workflow, claims };
  };

  const limit = bodyLimit({
    maxSize: DEPLOYMENT_REPORT_MAX_BYTES,
    onError: (c) => c.json({ error: "request body too large" }, 413),
  });

  app.post(DEPLOYMENTS_PATH, limit, async (c) => {
    const caller = await authenticate(c.req.header("authorization"));
    if (caller === 401) return c.json({ error: "unauthenticated" }, 401);
    if (caller === 403) return c.json({ error: "forbidden" }, 403);
    // After verification, so unauthenticated floods can't use up the cap.
    if (!limiter.tryTake()) return c.json({ error: "rate limited" }, 429);
    const body = DeploymentStartReport.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid request" }, 400);
    const plan = planStart(caller.workflow, body.data);
    if (!plan.ok) {
      log("WARNING", "deployment start refused", {
        reason: plan.reason,
        workflow: caller.workflow,
      });
      return c.json({ error: plan.reason }, 422);
    }
    // A release ships an earlier build: record that build's commit, found from a succeeded
    // deployment of the same digest (one bounded read). An unknown digest records nothing.
    let gitSha = caller.sha;
    if (plan.workflow === "release") {
      const recent = await deps.deployments.list(
        caller.project.id,
        plan.sourceEnvironment,
        DEPLOYMENT_LIMITS.maxPage,
      );
      const source = releaseSource(recent, body.data.imageDigest);
      if (!source) {
        log("WARNING", "deployment start refused", {
          reason: "no succeeded deployment of that digest",
          kind: plan.kind,
          environment: plan.sourceEnvironment,
        });
        return c.json({ error: "no succeeded deployment of that image digest" }, 422);
      }
      gitSha = source.gitSha;
    }
    const previous = await deps.deployments.latestGood(caller.project.id, plan.environment);
    const deployment = await deps.deployments.record({
      projectId: caller.project.id,
      environment: plan.environment,
      imageDigest: body.data.imageDigest,
      gitSha,
      revision: null,
      kind: plan.kind,
      status: "started",
      startedAt: now().toISOString(),
      finishedAt: null,
      actor: "system",
      previousDeploymentId: previous?.id ?? null,
      url: body.data.url ?? null,
      request: body.data.request ?? null,
    });
    log("INFO", "deployment started", {
      deploymentId: deployment.id,
      projectId: caller.project.id,
      environment: plan.environment,
      kind: plan.kind,
      gitSha,
      request: deployment.request,
      runId: caller.claims.run_id ?? null,
    });
    return c.json({ deploymentId: deployment.id }, 201);
  });

  app.post(DEPLOYMENT_FINISH_PATH, limit, async (c) => {
    const id = DeploymentId.safeParse(c.req.param("deploymentId"));
    if (!id.success) return c.json({ error: "not found" }, 404);
    const caller = await authenticate(c.req.header("authorization"));
    if (caller === 401) return c.json({ error: "unauthenticated" }, 401);
    if (caller === 403) return c.json({ error: "forbidden" }, 403);
    if (!limiter.tryTake()) return c.json({ error: "rate limited" }, 429);
    const body = FinishBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid request" }, 400);
    const current = await deps.deployments.get(id.data);
    // A deploy finishes only its own project's deploy of its commit; a release only its project's
    // promote or rollback (domain `mayFinish`).
    if (
      !current ||
      !mayFinish(current, {
        workflow: caller.workflow,
        projectId: caller.project.id,
        sha: caller.sha,
      })
    ) {
      log("WARNING", "deployment finish refused", {
        deploymentId: id.data,
        gitSha: caller.sha,
        workflow: caller.workflow,
      });
      return c.json({ error: "not found" }, 404);
    }
    try {
      const done = await deps.deployments.finish(id.data, {
        status: body.data.status,
        finishedAt: now().toISOString(),
        ...(body.data.revision ? { revision: body.data.revision } : {}),
      });
      log("INFO", "deployment finished", { deploymentId: done.id, status: done.status });
      if (deps.onFinished) {
        await deps.onFinished(done, caller.project).catch((err: unknown) =>
          log("WARNING", "deployment finish hook failed", {
            deploymentId: done.id,
            error: String(err),
          }),
        );
      }
      return c.json({ deploymentId: done.id, status: done.status }, 200);
    } catch (err) {
      if (err instanceof WorkTrackerError && err.code === "conflict") {
        return c.json({ error: "already finished" }, 409);
      }
      throw err;
    }
  });
}

/** Listed in `public-routes.ts` (AI-145): deploy and release workflows present an Actions OIDC token. */
export const publicRoutes: RouteModule = (app, s) => {
  const deployments = s.deps.deployments;
  if (!s.verifyActionsToken || !deployments) return;
  const repoIndex = new RepoIndex(s.deps.tracker, () => s.now().getTime());
  registerDeploymentCallbacks(app, {
    deployments,
    verify: s.verifyActionsToken,
    registeredProject: (repo) => repoIndex.projectFor(repo),
    now: s.now,
    ...(s.verification
      ? {
          onFinished: (deployment: Deployment, project: Project) =>
            s.verification!.deploymentFinished(deployment, project),
        }
      : {}),
  });
};
