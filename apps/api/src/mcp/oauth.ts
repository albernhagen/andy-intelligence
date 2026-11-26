import type { OAuthGrant, OAuthGrantStore } from "@andy/contracts";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { AuthEnv, VerifiedIdentity } from "../auth";
import {
  redirectUriAllowed,
  type ClientMetadataResolver,
  type OAuthClient,
} from "./client-metadata";
import { OAuthError } from "./errors";
import type { FixedWindowLimiter } from "./rate-limit";
import { hashToken, isTokenShaped, newToken, verifyPkceS256 } from "./tokens";

export const MCP_SCOPE = "mcp";
export const CODE_TTL_S = 60;
export const ACCESS_TTL_S = 60 * 60;
/** A refresh token's fixed limit from issue; using it never extends or shortens it. */
export const REFRESH_TTL_S = 30 * 24 * 60 * 60;
/**
 * A refresh returns a new refresh token only when the presented one has less than this left
 * (ADR-0158: Rotate MCP refresh tokens only near expiry); otherwise it returns the same one.
 */
export const ROTATE_WITHIN_S = 7 * 24 * 60 * 60;
const OAUTH_BODY_BYTES = 16 * 1024;

/** Why a refresh was refused; logged with the token's age, never its value. */
export type RefreshRefusal =
  | "malformed"
  | "unknown_or_expired"
  | "not_a_refresh_token"
  | "client_mismatch"
  | "user_not_allowed";

export interface McpAuthDeps {
  /** Public origin of this service, e.g. https://control-plane-….run.app (no trailing slash). */
  publicUrl: string;
  grants: OAuthGrantStore;
  clients: ClientMetadataResolver;
  allowedEmails: ReadonlySet<string>;
  now?: () => Date;
}

/** Shared per-instance cap on grant-store lookups from unauthenticated callers. */
export interface LookupCap {
  lookups: FixedWindowLimiter;
}

/** URLs derived from the public origin. The MCP endpoint is the OAuth protected resource. */
export function mcpUrls(publicUrl: string) {
  return {
    issuer: publicUrl,
    resource: `${publicUrl}/mcp`,
    resourceMetadata: `${publicUrl}/.well-known/oauth-protected-resource/mcp`,
  };
}

const AuthorizeParams = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(2000),
  redirect_uri: z.string().min(1).max(2000),
  // S256 of a verifier is always 32 bytes = 43 base64url characters.
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(2000).optional(),
  scope: z.string().max(200).optional(),
  resource: z.string().max(2000).optional(),
});
type AuthorizeParams = z.infer<typeof AuthorizeParams>;

function log(severity: "INFO" | "WARNING", message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ severity, message, component: "mcp-oauth", ...fields }));
}

/**
 * OAuth 2.1 authorization server for the MCP endpoint (ADR-0039: MCP OAuth facade).
 * Sign-in is delegated to the SPA's Firebase Google sign-in: /oauth/authorize validates the
 * request and sends the browser to /oauth/consent; the SPA posts the approval with the
 * user's Firebase ID token to /api/oauth/approve, which the /api allow-list guards.
 * Nothing is written before the allow-listed user approves.
 */
export function registerOAuthRoutes(app: Hono<AuthEnv>, deps: McpAuthDeps & LookupCap) {
  const urls = mcpUrls(deps.publicUrl);
  const now = deps.now ?? (() => new Date());
  const expiresIn = (seconds: number) => new Date(now().getTime() + seconds * 1000).toISOString();
  const allowed = (email: string) => deps.allowedEmails.has(email.toLowerCase());

  async function validate(raw: unknown): Promise<{ params: AuthorizeParams; client: OAuthClient }> {
    const parsed = AuthorizeParams.safeParse(raw);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new OAuthError("invalid_request", `invalid or missing: ${fields}`);
    }
    const params = parsed.data;
    if (params.resource !== undefined && params.resource !== urls.resource) {
      throw new OAuthError("invalid_target", "unknown resource");
    }
    const scopes = (params.scope ?? "").split(" ").filter(Boolean);
    if (scopes.some((s) => s !== MCP_SCOPE)) {
      throw new OAuthError("invalid_scope", `only "${MCP_SCOPE}" is supported`);
    }
    const client = await deps.clients.resolve(params.client_id);
    if (!redirectUriAllowed(client, params.redirect_uri)) {
      throw new OAuthError("invalid_request", "redirect_uri is not registered for this client");
    }
    return { params, client };
  }

  /** A token-shaped credential within the lookup cap, or an OAuth error. */
  function lookupKey(token: string): string {
    if (!isTokenShaped(token)) throw new OAuthError("invalid_grant", "malformed credential");
    if (!deps.lookups.tryTake()) throw new RateLimited();
    return hashToken(token);
  }

  /** Seconds since a refresh grant was issued: its expiry is always issue + REFRESH_TTL_S. */
  function refreshAgeS(grant: OAuthGrant): number {
    const issuedMs = Date.parse(grant.expiresAt) - REFRESH_TTL_S * 1000;
    return Math.max(0, Math.round((now().getTime() - issuedMs) / 1000));
  }

  /** Logs why a refresh was refused (reason and token age, no token value) and refuses it. */
  function refuseRefresh(
    reason: RefreshRefusal,
    clientId: string,
    grant: OAuthGrant | null = null,
  ): never {
    log("WARNING", "oauth refresh refused", {
      reason,
      clientId,
      uid: grant?.uid ?? null,
      // null when the store has no live grant: unknown, revoked or past its limit.
      tokenAgeS: grant ? refreshAgeS(grant) : null,
    });
    throw new OAuthError("invalid_grant", "refresh token is invalid, expired or revoked");
  }

  function oauthError(c: Context, err: unknown) {
    if (err instanceof RateLimited) {
      log("WARNING", "oauth request rate limited", { path: c.req.path });
      c.header("retry-after", "60");
      return c.json({ error: "rate_limited" }, 429);
    }
    if (!(err instanceof OAuthError)) throw err;
    log("WARNING", "oauth request rejected", {
      path: c.req.path,
      error: err.code,
      detail: err.description,
    });
    c.header("cache-control", "no-store");
    return c.json(err.toJSON(), err.code === "invalid_client" ? 401 : 400);
  }

  /** A new access token, plus a new refresh token unless `keepRefresh` is passed back. */
  async function issueTokens(
    base: OAuthGrant,
    identity: Pick<VerifiedIdentity, "email" | "uid">,
    keepRefresh?: string,
  ) {
    const access = newToken();
    const common = {
      clientId: base.clientId,
      email: identity.email,
      uid: identity.uid,
      resource: base.resource,
      scope: base.scope,
      redirectUri: null,
      codeChallenge: null,
    };
    await deps.grants.put(hashToken(access), {
      ...common,
      kind: "access",
      expiresAt: expiresIn(ACCESS_TTL_S),
    });
    const refresh = keepRefresh ?? newToken();
    if (!keepRefresh) {
      await deps.grants.put(hashToken(refresh), {
        ...common,
        kind: "refresh",
        expiresAt: expiresIn(REFRESH_TTL_S),
      });
    }
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh,
      scope: base.scope,
    };
  }

  // ── Discovery (RFC 9728, RFC 8414) ─────────────────────────────────────────
  const resourceMetadata = {
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
  };
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(resourceMetadata));
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(resourceMetadata));
  app.get("/.well-known/oauth-authorization-server", (c) =>
    c.json({
      issuer: urls.issuer,
      authorization_endpoint: `${urls.issuer}/oauth/authorize`,
      token_endpoint: `${urls.issuer}/oauth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      scopes_supported: [MCP_SCOPE],
    }),
  );

  // ── Authorization endpoint ─────────────────────────────────────────────────
  // Errors are shown (400), never redirected: the redirect URI isn't trusted until the
  // client is resolved, and this is a single-user spike.
  app.get("/oauth/authorize", async (c) => {
    try {
      const { params, client } = await validate(c.req.query());
      const consent = new URLSearchParams({ ...params, client_name: client.clientName });
      log("INFO", "oauth authorize: consent requested", { clientId: client.clientId });
      return c.redirect(`/oauth/consent?${consent}`, 302);
    } catch (err) {
      return oauthError(c, err);
    }
  });

  // Runs behind the /api middleware: valid Firebase ID token + allow-list.
  app.post("/api/oauth/approve", async (c) => {
    try {
      const { params, client } = await validate(await c.req.json().catch(() => null));
      const identity = c.get("identity");
      const code = newToken();
      await deps.grants.put(hashToken(code), {
        kind: "code",
        clientId: client.clientId,
        email: identity.email,
        uid: identity.uid,
        resource: urls.resource,
        scope: MCP_SCOPE,
        redirectUri: params.redirect_uri,
        codeChallenge: params.code_challenge,
        expiresAt: expiresIn(CODE_TTL_S),
      });
      const redirect = new URL(params.redirect_uri);
      redirect.searchParams.set("code", code);
      if (params.state !== undefined) redirect.searchParams.set("state", params.state);
      redirect.searchParams.set("iss", urls.issuer);
      log("INFO", "oauth approve: code issued", { clientId: client.clientId, uid: identity.uid });
      return c.json({ redirect: redirect.toString() });
    } catch (err) {
      return oauthError(c, err);
    }
  });

  // ── Token endpoint ─────────────────────────────────────────────────────────
  app.use(
    "/oauth/token",
    bodyLimit({
      maxSize: OAUTH_BODY_BYTES,
      onError: (c) =>
        c.json({ error: "invalid_request", error_description: "body too large" }, 413),
    }),
  );
  app.post("/oauth/token", async (c) => {
    try {
      const form = await c.req.parseBody();
      const field = (name: string) => {
        const value = form[name];
        return typeof value === "string" ? value : undefined;
      };
      const clientId = field("client_id");
      if (!clientId) throw new OAuthError("invalid_request", "client_id is required");
      const resource = field("resource");
      if (resource !== undefined && resource !== urls.resource) {
        throw new OAuthError("invalid_target", "unknown resource");
      }

      const grantType = field("grant_type");
      let grant: OAuthGrant | null;
      if (grantType === "authorization_code") {
        const code = field("code");
        const verifier = field("code_verifier");
        if (!code || !verifier)
          throw new OAuthError("invalid_request", "code and code_verifier are required");
        grant = await deps.grants.take(lookupKey(code));
        if (
          !grant ||
          grant.kind !== "code" ||
          grant.clientId !== clientId ||
          grant.redirectUri !== field("redirect_uri") ||
          !verifyPkceS256(verifier, grant.codeChallenge ?? "")
        ) {
          throw new OAuthError("invalid_grant", "code is invalid, expired or already used");
        }
      } else if (grantType === "refresh_token") {
        const refresh = field("refresh_token");
        if (!refresh) throw new OAuthError("invalid_request", "refresh_token is required");
        if (!isTokenShaped(refresh)) refuseRefresh("malformed", clientId);
        grant = await deps.grants.get(lookupKey(refresh));
        if (!grant) refuseRefresh("unknown_or_expired", clientId);
        if (grant.kind !== "refresh") refuseRefresh("not_a_refresh_token", clientId, grant);
        if (grant.clientId !== clientId) refuseRefresh("client_mismatch", clientId, grant);
        if (!allowed(grant.email)) refuseRefresh("user_not_allowed", clientId, grant);
        // Rotate only near expiry (ADR-0158): sessions that share one stored token, or hold
        // an older one, keep working until that token's own fixed limit. Nothing is written
        // to the presented grant, so concurrent refreshes can't race each other.
        const remainingS = (Date.parse(grant.expiresAt) - now().getTime()) / 1000;
        const rotated = remainingS <= ROTATE_WITHIN_S;
        const body = await issueTokens(grant, grant, rotated ? undefined : refresh);
        log("INFO", "oauth token issued", {
          grantType,
          clientId,
          uid: grant.uid,
          rotated,
          tokenAgeS: refreshAgeS(grant),
        });
        c.header("cache-control", "no-store");
        return c.json(body);
      } else {
        throw new OAuthError("unsupported_grant_type", "use authorization_code or refresh_token");
      }

      if (!allowed(grant.email)) throw new OAuthError("invalid_grant", "user is no longer allowed");
      const body = await issueTokens(grant, grant);
      log("INFO", "oauth token issued", { grantType, clientId, uid: grant.uid });
      c.header("cache-control", "no-store");
      return c.json(body);
    } catch (err) {
      return oauthError(c, err);
    }
  });
}

class RateLimited extends Error {}
