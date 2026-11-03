import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AuthEnv } from "../auth";
import { FixedWindowLimiter } from "../mcp/rate-limit";
import type { GitHubConnection } from "./connection";

/**
 * Repo tokens for CI jobs (ADR-0043). A workflow proves who it is with its GitHub Actions
 * OIDC token (audience = this service's URL); only workflows in TOKEN_POLICY get a 1-hour
 * token with contents + pull requests write on their own repo. No secret is stored in GitHub.
 */

export const TOKEN_PATH = "/github/token";
/** Tokens issued per instance per minute (max 2 instances; ADR-0028). */
export const TOKEN_RATE_LIMIT = 30;

export const ACTIONS_ISSUER = "https://token.actions.githubusercontent.com";

/** The OIDC claims we check. `workflow_ref` = "owner/repo/.github/workflows/x.yml@refs/heads/main". */
export interface ActionsClaims {
  repository: string;
  workflow_ref: string;
}

export type ActionsTokenVerifier = (jwt: string) => Promise<ActionsClaims>;

/** Workflows that may get a repo token. M1.6: Claude Code executor adds its workflow here. */
export const TOKEN_POLICY: readonly ActionsClaims[] = [
  {
    repository: "albernhagen/andy-intelligence",
    workflow_ref:
      "albernhagen/andy-intelligence/.github/workflows/system-security-review.yml@refs/heads/main",
  },
];

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
    return { repository: payload.repository, workflow_ref: payload.workflow_ref };
  };
}

export interface TokenDeps {
  connection: GitHubConnection;
  verify: ActionsTokenVerifier;
  policy?: readonly ActionsClaims[];
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
      const allowed = policy.some(
        (p) => p.repository === claims.repository && p.workflow_ref === claims.workflow_ref,
      );
      if (!allowed) {
        log("WARNING", "workflow not allowed a repo token", { ...claims });
        return c.json({ error: "forbidden" }, 403);
      }
      // After verification, so unauthenticated floods can't use up the cap.
      if (!limiter.tryTake()) return c.json({ error: "rate limited" }, 429);

      const host = await deps.connection.codeHost();
      if (!host) return c.json({ error: "GitHub is not connected" }, 503);
      const token = await host.issueRepoToken(claims.repository);
      if (!token) return c.json({ error: "GitHub App is not installed on the repo" }, 403);
      log("INFO", "repo token issued", { ...claims, expiresAt: token.expiresAt });
      return c.json(token, 200);
    },
  );
}
