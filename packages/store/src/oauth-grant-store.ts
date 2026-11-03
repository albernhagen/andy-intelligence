import { Timestamp, type Firestore } from "@google-cloud/firestore";
import { OAuthGrant, type OAuthGrantStore } from "@andy/contracts";
import { SCHEMA_VERSION, collections } from "./index";

/** Firestore TTL policy field (Terraform `oauth_grant_ttl`): expired grants are deleted. */
export const OAUTH_GRANT_TTL_FIELD = "ttl";

/**
 * OAuthGrantStore on Firestore. One document per grant, keyed by the token hash. Expired
 * documents read as missing; the TTL policy deletes them later (usually within a day).
 */
export class FirestoreOAuthGrantStore implements OAuthGrantStore {
  constructor(
    private readonly db: Firestore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private doc(key: string) {
    return this.db.collection(collections.oauthGrants.path()).doc(key);
  }

  async put(key: string, grant: OAuthGrant): Promise<void> {
    const parsed = OAuthGrant.parse(grant);
    await this.doc(key).set({
      ...parsed,
      _v: SCHEMA_VERSION,
      [OAUTH_GRANT_TTL_FIELD]: Timestamp.fromDate(new Date(parsed.expiresAt)),
    });
  }

  async get(key: string): Promise<OAuthGrant | null> {
    return this.live((await this.doc(key).get()).data());
  }

  async take(key: string): Promise<OAuthGrant | null> {
    const ref = this.doc(key);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      tx.delete(ref);
      return this.live(snap.data());
    });
  }

  private live(data: Record<string, unknown> | undefined): OAuthGrant | null {
    if (!data) return null;
    const grant = OAuthGrant.parse(data);
    return Date.parse(grant.expiresAt) <= this.now().getTime() ? null : grant;
  }
}
