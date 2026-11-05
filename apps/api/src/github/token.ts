import { WorkTrackerError, type RunExecutor } from "@andy/contracts";
import { DomainError } from "@andy/domain";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AuthEnv } from "../auth";
import { z } from "zod";
import { FixedWindowLimiter } from "../mcp/rate-limit";
import type { GitHubConnection } from "./connection";

/**
 * Repo tokens for CI jobs (ADR-0043). A workflow proves who it is with its GitHub Actions
 * OIDC token (audience = this service's URL); only workflows in TOKEN_POLICY get a 1-hour
 * token with contents + pull requests write on their own repo. No secret is stored in GitHub.
 * The executor's entry is narrower (ADR-0063): one token per build run in flight, for the
 * workflow run it was dispatched to; the body names the run (`{"runId": "..."}`).
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
 * Workflows that may get a repo token: the system security review, and the Claude Code
 * executor's `publish` job (called from this repo's agent-run.yml on main) for build runs.
 * Until M5: Multi-project in parallel only this repo runs agents (ADR-0051).
 */
export const TOKEN_POLICY: readonly TokenPolicyEntry[] = [
  {
    repository: "albernhagen/andy-intelligence",
    workflow_ref:
      "albernhagen/andy-intelligence/.github/workflows/system-security-review.yml@refs/heads/main",
  },
  {
    repository: "albernhagen/andy-intelligence",
    workflow_ref: "albernhagen/andy-intelligence/.github/workflows/agent-run.yml@refs/heads/main",
    job_workflow_ref:
      "albernhagen/andy-intelligence/.github/workflows/claude-executor.yml@refs/heads/main",
    runGrant: true,
  },
];

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
    };
  };
}

export interface TokenDeps {
  connection: GitHubConnection;
  verify: ActionsTokenVerifier;
  policy?: readonly TokenPolicyEntry[];
  /** For `runGrant` entries; without it they get no token. */
  claimRunGrant?: RunGrant;
  now?: () => Date;
}

function log(severity: "INFO" | "WARNING", message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ severity, message, component: "github-token", ...fields }));
}

export function registerGitHubToken(app: Hono<AuthEnv>, deps: TokenDeps): void {
  const policy = deps.policy ?? TOKEN_POLICY;
  const now = deps.now ?? (() => new Date());
  const limiter = new FixedWindowLimiter(TOKEN_RATE_LIMIT, 60_000, () => now().getTime());

  app.post(
    TOKEN_PATH,
    bodyLimit({ maxSize: 1024, onError: (c) => c.json({ error: "request body too large" }, 413) }),
    async (c) => {
      const match = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
      let claims: ActionsClaims;
      try {
        if (!match?.[1]) throw new Error("no bearer token");
        claims = await deps.verify(match[1]);
      } catch {
        log("WARNING", "actions token rejected");
        return c.json({ error: "unauthenticated" }, 401);
      }
      const entry = policy.find(
        (p) =>
          p.repository === claims.repository &&
          p.workflow_ref === claims.workflow_ref &&
          (p.job_workflow_ref === undefined || p.job_workflow_ref === claims.job_workflow_ref),
      );
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

      const host = await deps.connection.codeHost();
      if (!host) return c.json({ error: "GitHub is not connected" }, 503);
      const token = await host.issueRepoToken(claims.repository);
      if (!token) return c.json({ error: "GitHub App is not installed on the repo" }, 403);
      log("INFO", "repo token issued", { ...claims, expiresAt: token.expiresAt });
      return c.json(token, 200);
    },
  );
}
