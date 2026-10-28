import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { TokenVerifier } from "./auth";

/**
 * Verifies Firebase / Identity Platform ID tokens using Application Default Credentials.
 * `checkRevoked` adds a network round trip; worth it for a single-user control plane.
 */
export function firebaseVerifier(projectId: string): TokenVerifier {
  const app = getApps()[0] ?? initializeApp({ projectId });
  const auth = getAuth(app);
  return {
    async verify(token) {
      const decoded = await auth.verifyIdToken(token, true);
      return {
        uid: decoded.uid,
        email: decoded.email ?? "",
        emailVerified: decoded.email_verified ?? false,
      };
    },
  };
}
