import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A new bearer credential: 256 random bits, base64url. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** True if the string could be a token we issued (43 base64url chars); checked before any lookup. */
export function isTokenShaped(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** Storage key for a token: grants are stored by hash, never by the token itself. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

/** PKCE S256 (RFC 7636 §4.6): BASE64URL(SHA256(verifier)) must equal the challenge. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}
