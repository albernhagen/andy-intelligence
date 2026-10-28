import type { MiddlewareHandler } from "hono";

export interface VerifiedIdentity {
  uid: string;
  email: string;
  emailVerified: boolean;
}

/** Verifies a bearer ID token. Implemented by Firebase in prod and a stub in tests. */
export interface TokenVerifier {
  verify(token: string): Promise<VerifiedIdentity>;
}

export type AuthEnv = { Variables: { identity: VerifiedIdentity } };

/**
 * Rejects requests unless they carry a valid ID token for a verified email on the allow-list.
 * Allow-list comparison is case-insensitive. 401 = no/invalid token, 403 = not allowed.
 */
export function requireAllowedUser(
  verifier: TokenVerifier,
  allowedEmails: ReadonlySet<string>,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match?.[1]) return c.json({ error: "unauthenticated" }, 401);

    let identity: VerifiedIdentity;
    try {
      identity = await verifier.verify(match[1]);
    } catch {
      return c.json({ error: "unauthenticated" }, 401);
    }

    if (!identity.emailVerified || !allowedEmails.has(identity.email.toLowerCase())) {
      return c.json({ error: "forbidden" }, 403);
    }

    c.set("identity", identity);
    await next();
  };
}

export function parseAllowList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}
