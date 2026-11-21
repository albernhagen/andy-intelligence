import { WorkTrackerError, type Project, type RunExecutor } from "@andy/contracts";
import { AGENT_RUN_WORKFLOW, CLAUDE_EXECUTOR_REF } from "@andy/github";
import { DomainError } from "@andy/domain";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AuthEnv } from "../auth";
import { z } from "zod";
import { FixedWindowLimiter } from "../mcp/rate-limit";
import { RUN_TOKEN_SHAPE } from "../runners";
import type { GitHubConnection } from "./connection";
import type { RouteModule } from "../services";
import { RepoIndex } from "./webhooks";

/**
 * Repo tokens for CI jobs (ADR-0043). A workflow proves who it is with its GitHub Actions
 * OIDC token (audience = this service's URL); only workflows in TOKEN_POLICY get a 1-hour
 * token with contents + pull requests write on their own repo. No secret is stored in GitHub.
 * The executor's rule is narrower (ADR-0063, ADR-0096): a registered project's caller running the
 * platform executor gets one token per build run in flight, for the workflow run it was
 * dispatched to; the body names the run (`{"runId": "..."}`).
 */

export const TOKEN_PATH = "/github/token";
/** Tokens issued per instance per minute (max 2 instances; ADR-0028). */
export const TOKEN_RATE_LIMIT = 30;

export const ACTIONS_ISSUER = "https://token.actions.githubusercontent.com";

/** The OIDC claims we check. `workflow_ref` = "owner/repo/.github/workflows/x.yml@refs/heads/main". */
export interface ActionsClaims {
  repository: string;
  workflow_ref: string;
  /** The workflow the job runs in; a reusable workflow's own ref (agent run callbacks). */
  job_workflow_ref?: string;
  /** The workflow run's ID (agent run callbacks). */
  run_id?: string;
  /** The commit the workflow run is for (deployment callbacks, AI-180). */
  sha?: string;
}

export type ActionsTokenVerifier = (jwt: string) => Promise<ActionsClaims>;

/** A workflow that may get a repo token. `runGrant`: only through its build run's one grant. */
export interface TokenPolicyEntry {
  repository: string;
  workflow_ref: string;
  /** When set, the job's own workflow (a reusable one) must match too. */
  job_workflow_ref?: string;
  runGrant?: boolean;
}

/**
 * Fixed workflows that may get a repo token (this repo only): the system security review, and the
 * PR re-sync on pushes to main (ADR-0111: its pushes must start the PR's checks, which a
 * GITHUB_TOKEN push doesn't). Agent tasks' publish jobs go through `executorEntry` (ADR-0096).
 */
export const TOKEN_POLICY: readonly TokenPolicyEntry[] = [
  {
    repository: "albernhagen/andy-intelligence",
    workflow_ref:
      "albernhagen/andy-intelligence/.github/workflows/system-security-review.yml@refs/heads/main",
  },
  {
    repository: "albernhagen/andy-intelligence",
    workflow_ref: "albernhagen/andy-intelligence/.github/workflows/resync-prs.yml@refs/heads/main",
  },
];

/** The project a repo is registered to, or null (case-insensitive; cached by the caller). */
export type RegisteredProject = (repo: string) => Promise<Project | null>;

/**
 * The executor rule (ADR-0096): the caller is `agent-run.yml` on `main` in its own repo, the job
 * runs the platform's `claude-executor.yml@refs/heads/main`, and the repo is registered to an
 * enabled project. Null when any part differs. The run grant then checks the run itself.
 */
export async function executorEntry(
  claims: ActionsClaims,
  registered: RegisteredProject,
): Promise<TokenPolicyEntry | null> {
  const callerRef = `${claims.repository}/.github/workflows/${AGENT_RUN_WORKFLOW}@refs/heads/main`;
  if (claims.job_workflow_ref !== CLAUDE_EXECUTOR_REF || claims.workflow_ref !== callerRef) {
    return null;
  }
  const project = await registered(claims.repository);
  if (!project?.enabled) return null;
  return { ...claims, job_workflow_ref: CLAUDE_EXECUTOR_REF, runGrant: true };
}

/** Claims a build run's one push grant; throws DomainError when refused. */
export type RunGrant = (runId: string, caller: RunExecutor) => Promise<unknown>;

const RunGrantBody = z.strictObject({ runId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/) });

/** Verifies signature (GitHub's JWKS, cached by jose), issuer, audience and expiry. */
export function actionsTokenVerifier(
  audience: string,
  /** Test seam: a local key set instead of GitHub's. */
  jwks: JWTVerifyGetKey = createRemoteJWKSet(new URL(`${ACTIONS_ISSUER}/.well-known/jwks`)),
): ActionsTokenVerifier {
  return async (jwt) => {
    const { payload } = await jwtVerify(jwt, jwks, { issuer: ACTIONS_ISSUER, audience });
    if (typeof payload.repository !== "string" || typeof payload.workflow_ref !== "string") {
      throw new Error("token lacks repository or workflow_ref");
    }
    const optional = (v: unknown) => (typeof v === "string" ? v : undefined);
    return {
      repository: payload.repository,
      workflow_ref: payload.workflow_ref,
      job_workflow_ref: optional(payload.job_workflow_ref),
      run_id: optional(payload.run_id),
      sha: optional(payload.sha),
    };
  };
}

/**
 * A local runner's push grant (ADR-0089): its per-run token checked for the run, then the run's
 * one grant claimed; the token is for the run's project repo.
 */
export interface LocalRunGrant {
  authenticate(token: string, runId: string): Promise<{ runnerId: string } | null>;
  claim(runId: string, caller: { runnerId: string }): Promise<{ repo: string }>;
}

/** Per-run token lookups per instance per minute, before the store (as on run callbacks, ADR-0094). */
export const LOCAL_TOKEN_LOOKUPS_PER_MINUTE = 60;

export interface TokenDeps {
  connection: GitHubConnection;
  verify: ActionsTokenVerifier;
  /** Local runners' push grants; absent: per-run tokens get 401. */
  local?: LocalRunGrant;
  policy?: readonly TokenPolicyEntry[];
  /** For `runGrant` entries; without it they get no token. */
  claimRunGrant?: RunGrant;
  /** Which project owns a repo; without it no agent task gets a token. */
  registeredProject?: RegisteredProject;
  now?: () => Date;
}

function log(severity: "INFO" | "WARNING", message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ severity, message, component: "github-token", ...fields }));
}

export function registerGitHubToken(app: Hono<AuthEnv>, deps: TokenDeps): void {
  const policy = deps.policy ?? TOKEN_POLICY;
  const now = deps.now ?? (() => new Date());
  const limiter = new FixedWindowLimiter(TOKEN_RATE_LIMIT, 60_000, () => now().getTime());
  const localLookups = new FixedWindowLimiter(LOCAL_TOKEN_LOOKUPS_PER_MINUTE, 60_000, () =>
    now().getTime(),
  );
  // Local grants have their own bucket, so they can't starve Actions publishes (or the reverse).
  const localIssues = new FixedWindowLimiter(TOKEN_RATE_LIMIT, 60_000, () => now().getTime());

  app.post(
    TOKEN_PATH,
    bodyLimit({ maxSize: 1024, onError: (c) => c.json({ error: "request body too large" }, 413) }),
    async (c) => {
      const match = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
      if (match?.[1] && RUN_TOKEN_SHAPE.test(match[1])) {
        return localGrant(c, match[1]);
      }
      let claims: ActionsClaims;
      try {
        if (!match?.[1]) throw new Error("no bearer token");
        claims = await deps.verify(match[1]);
      } catch {
        log("WARNING", "actions token rejected");
        return c.json({ error: "unauthenticated" }, 401);
      }
      const entry =
        policy.find(
          (p) =>
            p.repository === claims.repository &&
            p.workflow_ref === claims.workflow_ref &&
            (p.job_workflow_ref === undefined || p.job_workflow_ref === claims.job_workflow_ref),
        ) ?? (deps.registeredProject ? await executorEntry(claims, deps.registeredProject) : null);
      if (!entry) {
        log("WARNING", "workflow not allowed a repo token", { ...claims });
        return c.json({ error: "forbidden" }, 403);
      }
      // After verification, so unauthenticated floods can't use up the cap.
      if (!limiter.tryTake()) return c.json({ error: "rate limited" }, 429);

      if (entry.runGrant) {
        const body = RunGrantBody.safeParse(await c.req.json().catch(() => null));
        if (!body.success || !deps.claimRunGrant || !claims.run_id || !claims.job_workflow_ref) {
          log("WARNING", "executor token request without a valid run", { ...claims });
          return c.json({ error: "forbidden" }, 403);
        }
        try {
          await deps.claimRunGrant(body.data.runId, {
            repo: claims.repository,
            ref: claims.job_workflow_ref,
            externalId: claims.run_id,
          });
        } catch (err) {
          if (!(err instanceof DomainError || err instanceof WorkTrackerError)) throw err;
          log("WARNING", "executor token refused", {
            ...claims,
            runId: body.data.runId,
            reason: err.message,
          });
          return c.json(
            { error: err.message },
            err instanceof DomainError ? 403 : err.code === "not_found" ? 404 : 409,
          );
        }
      }

      return issue(c, claims.repository, { ...claims });
    },
  );

  async function issue(c: Context, repository: string, fields: Record<string, unknown>) {
    const host = await deps.connection.codeHost();
    if (!host) return c.json({ error: "GitHub is not connected" }, 503);
    const token = await host.issueRepoToken(repository);
    if (!token) return c.json({ error: "GitHub App is not installed on the repo" }, 403);
    log("INFO", "repo token issued", { ...fields, repository, expiresAt: token.expiresAt });
    return c.json(token, 200);
  }

  /**
   * A local build's push token (ADR-0089): the runner's per-run token for the named run, the
   * run's one grant (refused a second time, or once the run ended), a token for its repo.
   */
  async function localGrant(c: Context, runToken: string) {
    const body = RunGrantBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success || !deps.local) return c.json({ error: "unauthenticated" }, 401);
    const runId = body.data.runId;
    if (!localLookups.tryTake()) return c.json({ error: "rate limited" }, 429);
    const caller = await deps.local.authenticate(runToken, runId);
    if (!caller) {
      log("WARNING", "per-run token rejected for a push token", { runId });
      return c.json({ error: "unauthenticated" }, 401);
    }
    if (!localIssues.tryTake()) return c.json({ error: "rate limited" }, 429);
    let repo: string;
    try {
      ({ repo } = await deps.local.claim(runId, caller));
    } catch (err) {
      if (!(err instanceof DomainError || err instanceof WorkTrackerError)) throw err;
      log("WARNING", "local push token refused", { runId, ...caller, reason: err.message });
      return c.json(
        { error: err.message },
        err instanceof DomainError ? 403 : err.code === "not_found" ? 404 : 409,
      );
    }
    return issue(c, repo, { runId, ...caller });
  }
}

/** Listed in `public-routes.ts` (AI-145): CI jobs present an Actions OIDC token. Needs the GitHub App. */
export const publicRoutes: RouteModule = (app, s) => {
  const { connection, verifyActionsToken } = s;
  if (!connection || !verifyActionsToken) return;
  const repoIndex = new RepoIndex(s.tracker, () => s.now().getTime());
  registerGitHubToken(app, {
    connection,
    verify: verifyActionsToken,
    claimRunGrant: (runId, caller) => s.runs.claimPushGrant(runId, caller),
    registeredProject: (repo) => repoIndex.projectFor(repo),
    ...(s.runners
      ? {
          local: {
            authenticate: (token: string, runId: string) =>
              s.runners!.authenticateRun(token, runId),
            claim: (runId: string, caller: { runnerId: string }) =>
              s.runs.claimLocalPushGrant(runId, caller),
          },
        }
      : {}),
    now: s.now,
  });
};
