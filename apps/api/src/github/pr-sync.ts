import type { Project, PrSync } from "@andy/contracts";
import type { Hono } from "hono";
import type { AuthEnv } from "../auth";
import { FixedWindowLimiter } from "../mcp/rate-limit";
import type { RouteModule } from "../services";
import type { ActionsClaims, ActionsTokenVerifier } from "./token";
import { RepoIndex } from "./webhooks";

/**
 * The PR sync setting for the Re-sync open PRs workflow (AI-388, ADR-0157). The workflow proves
 * who it is with the GitHub Actions OIDC token it already asks for (`/github/token`, ADR-0043),
 * so no new credential: only a repo's own `resync-prs.yml` on `main`, in a repo registered to an
 * enabled project, gets an answer, and it is the one setting. `queue`: the workflow skips (the
 * merge queue syncs the PR that is next); `all`: it re-syncs every open PR, as before.
 */

export const PR_SYNC_PATH = "/github/pr-sync";
/** Reads per instance per minute (max 2 instances; ADR-0028). One per push to main. */
export const PR_SYNC_RATE_LIMIT = 30;
export const RESYNC_WORKFLOW = "resync-prs.yml";

/** The repo's own re-sync workflow on `main`. */
export const resyncWorkflowRef = (repository: string) =>
  `${repository}/.github/workflows/${RESYNC_WORKFLOW}@refs/heads/main`;

function log(severity: "INFO" | "WARNING", message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ severity, message, component: "pr-sync", ...fields }));
}

export interface PrSyncDeps {
  verify: ActionsTokenVerifier;
  /** The project a repo is registered to, or null (may be cached). */
  registeredProject: (repo: string) => Promise<Project | null>;
  /** The project as stored now, so a change in Settings counts at once. */
  getProject: (id: string) => Promise<Project | null>;
  now?: () => Date;
}

export function registerPrSync(app: Hono<AuthEnv>, deps: PrSyncDeps): void {
  const now = deps.now ?? (() => new Date());
  const limiter = new FixedWindowLimiter(PR_SYNC_RATE_LIMIT, 60_000, () => now().getTime());

  app.post(PR_SYNC_PATH, async (c) => {
    if (!limiter.tryTake()) {
      log("WARNING", "pr sync read rate limited");
      return c.json({ error: "rate_limited" }, 429);
    }
    const jwt = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
    let claims: ActionsClaims;
    try {
      if (!jwt) throw new Error("no bearer token");
      claims = await deps.verify(jwt);
    } catch {
      log("WARNING", "pr sync token rejected");
      return c.json({ error: "unauthenticated" }, 401);
    }
    const refuse = (reason: string) => {
      log("WARNING", "pr sync read refused", {
        reason,
        repository: claims.repository,
        workflow_ref: claims.workflow_ref,
      });
      return c.json({ error: "forbidden" }, 403);
    };
    if (claims.workflow_ref !== resyncWorkflowRef(claims.repository)) {
      return refuse("not the repo's re-sync workflow on main");
    }
    const registered = await deps.registeredProject(claims.repository);
    const project = registered ? await deps.getProject(registered.id) : null;
    if (!project?.enabled) return refuse("repo is not registered to an enabled project");
    const prSync: PrSync = project.prSync;
    log("INFO", "pr sync read", { repository: claims.repository, project: project.key, prSync });
    return c.json({ prSync }, 200);
  });
}

export const publicRoutes: RouteModule = (app, s) => {
  if (!s.verifyActionsToken) return;
  const repoIndex = new RepoIndex(s.deps.tracker, () => s.now().getTime());
  registerPrSync(app, {
    verify: s.verifyActionsToken,
    registeredProject: (repo) => repoIndex.projectFor(repo),
    getProject: (id) => s.deps.tracker.getProject(id),
    now: s.now,
  });
};
