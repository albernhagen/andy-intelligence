import { Deployment, WorkTrackerError, type DeploymentStore, type Project } from "@andy/contracts";
import { z } from "@hono/zod-openapi";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AuthEnv } from "./auth";
import type { ActionsClaims, ActionsTokenVerifier } from "./github/token";
import { RepoIndex } from "./github/webhooks";
import { FixedWindowLimiter } from "./mcp/rate-limit";
import type { RouteModule } from "./services";

/**
 * Deployment reports from deploy workflows (AI-180: M6.4; M6: Dev → prod releases in `docs/architecture/milestones.md`). The workflow proves who it
 * is with its GitHub Actions OIDC token, like the run callbacks (ADR-0019): only a registered,
 * enabled project's `deploy.yml` on `main` is accepted, and every other caller gets 403 with
 * nothing recorded. The token, not the body, says which repo and commit; the body adds only what
 * the token can't know (image digest at the start, status and revision at the end).
 */

export const DEPLOYMENTS_PATH = "/deployments";
export const DEPLOYMENT_FINISH_PATH = "/deployments/:deploymentId/finish";
/** The workflow file that may report (path under `.github/workflows/`). */
export const DEPLOY_WORKFLOW = "deploy.yml";
/** Verified reports per instance per minute (max 2 instances; ADR-0028). A deploy sends two. */
export const DEPLOYMENT_REPORT_RATE_LIMIT = 30;
/** Report bodies are a few fields; anything larger is refused before parsing. */
export const DEPLOYMENT_REPORT_MAX_BYTES = 1024;

/** The one caller accepted: the repo's own deploy workflow on `main`. */
export function deployWorkflowRef(repository: string): string {
  return `${repository}/.github/workflows/${DEPLOY_WORKFLOW}@refs/heads/main`;
}

const StartBody = z.strictObject({ imageDigest: Deployment.shape.imageDigest });
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
  now?: () => Date;
}

type Caller = { project: Project; sha: string; claims: ActionsClaims };

export function registerDeploymentCallbacks(
  app: Hono<AuthEnv>,
  deps: DeploymentCallbackDeps,
): void {
  const now = deps.now ?? (() => new Date());
  const limiter = new FixedWindowLimiter(DEPLOYMENT_REPORT_RATE_LIMIT, 60_000, () =>
    now().getTime(),
  );

  /** The verified caller, or the status to answer: 401 bad token, 403 not the deploy workflow. */
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
    if (claims.workflow_ref !== deployWorkflowRef(claims.repository)) {
      return refuse("not the repo's deploy workflow on main");
    }
    if (!claims.sha || !GitSha.safeParse(claims.sha).success)
      return refuse("token has no commit sha");
    const project = await deps.registeredProject(claims.repository);
    if (!project?.enabled) return refuse("repo is not registered to an enabled project");
    return { project, sha: claims.sha, claims };
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
    const body = StartBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid request" }, 400);
    const previous = await deps.deployments.latestGood(caller.project.id, "prod");
    const deployment = await deps.deployments.record({
      projectId: caller.project.id,
      environment: "prod",
      imageDigest: body.data.imageDigest,
      gitSha: caller.sha,
      revision: null,
      kind: "deploy",
      status: "started",
      startedAt: now().toISOString(),
      finishedAt: null,
      actor: "system",
      previousDeploymentId: previous?.id ?? null,
    });
    log("INFO", "deployment started", {
      deploymentId: deployment.id,
      projectId: caller.project.id,
      gitSha: caller.sha,
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
    // Only the deployment this project's deploy of this commit started may be finished by it.
    if (!current || current.projectId !== caller.project.id || current.gitSha !== caller.sha) {
      log("WARNING", "deployment finish refused", { deploymentId: id.data, gitSha: caller.sha });
      return c.json({ error: "not found" }, 404);
    }
    try {
      const done = await deps.deployments.finish(id.data, {
        status: body.data.status,
        finishedAt: now().toISOString(),
        ...(body.data.revision ? { revision: body.data.revision } : {}),
      });
      log("INFO", "deployment finished", { deploymentId: done.id, status: done.status });
      return c.json({ deploymentId: done.id, status: done.status }, 200);
    } catch (err) {
      if (err instanceof WorkTrackerError && err.code === "conflict") {
        return c.json({ error: "already finished" }, 409);
      }
      throw err;
    }
  });
}

/** Listed in `public-routes.ts` (AI-145): deploy workflows present an Actions OIDC token. */
export const publicRoutes: RouteModule = (app, s) => {
  const deployments = s.deps.deployments;
  if (!s.verifyActionsToken || !deployments) return;
  const repoIndex = new RepoIndex(s.deps.tracker, () => s.now().getTime());
  registerDeploymentCallbacks(app, {
    deployments,
    verify: s.verifyActionsToken,
    registeredProject: (repo) => repoIndex.projectFor(repo),
    now: s.now,
  });
};
