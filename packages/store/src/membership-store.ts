import { createHash } from "node:crypto";
import type { Firestore } from "@google-cloud/firestore";
import {
  MEMBERSHIPS_MAX,
  MEMBERS_PER_PROJECT_MAX,
  MemberEmail,
  MemberUid,
  Membership,
  MembershipCapError,
  MembershipProjectId,
  byMemberEmail,
  byMembershipProject,
  type MembershipInput,
  type MembershipStore,
} from "@andy/contracts";
import { zodConverter } from "./index";

export const MEMBERSHIPS_COLLECTION = "memberships";

/**
 * `<projectId>:<sha256(email)>`: one document per project and email, and no email in a
 * document path (paths appear in logs and errors; ADR-0015).
 */
export const membershipDocId = (projectId: string, email: string) =>
  `${MembershipProjectId.parse(projectId)}:${createHash("sha256").update(MemberEmail.parse(email)).digest("hex")}`;

/**
 * MembershipStore on Firestore (M8.2, ADR-0127), server-only (the rules deny every client read
 * and write): `memberships/{projectId}:{sha256(email)}`. Queries are single equality filters on
 * `email` or `projectId`, sorted in memory: no composite index. Every read is capped
 * (ADR-0126): a project holds at most MEMBERS_PER_PROJECT_MAX, the whole store MEMBERSHIPS_MAX,
 * and the total is a count aggregate, not a read of the collection. `put` checks both caps
 * inside a transaction, so concurrent puts can't pass them. Nothing here logs.
 */
export class FirestoreMembershipStore implements MembershipStore {
  constructor(private readonly db: Firestore) {}

  private coll() {
    return this.db.collection(MEMBERSHIPS_COLLECTION).withConverter(zodConverter(Membership));
  }

  private ofEmail(email: string) {
    return this.coll().where("email", "==", MemberEmail.parse(email)).limit(MEMBERSHIPS_MAX);
  }

  private ofProject(projectId: string) {
    return this.coll()
      .where("projectId", "==", MembershipProjectId.parse(projectId))
      .limit(MEMBERS_PER_PROJECT_MAX);
  }

  async listForEmail(email: string): Promise<Membership[]> {
    return (await this.ofEmail(email).get()).docs.map((d) => d.data()).sort(byMembershipProject);
  }

  async listForProject(projectId: string): Promise<Membership[]> {
    return (await this.ofProject(projectId).get()).docs.map((d) => d.data()).sort(byMemberEmail);
  }

  async get(projectId: string, email: string): Promise<Membership | null> {
    return (await this.coll().doc(membershipDocId(projectId, email)).get()).data() ?? null;
  }

  async put(membership: MembershipInput): Promise<void> {
    const m = Membership.parse(membership);
    const ref = this.coll().doc(membershipDocId(m.projectId, m.email));
    await this.db.runTransaction(async (tx) => {
      if (!(await tx.get(ref)).exists) {
        const inProject = (await tx.get(this.ofProject(m.projectId).count())).data().count;
        if (inProject >= MEMBERS_PER_PROJECT_MAX) {
          throw new MembershipCapError("MEMBERS_PER_PROJECT_MAX", MEMBERS_PER_PROJECT_MAX);
        }
        const total = (await tx.get(this.coll().count())).data().count;
        if (total >= MEMBERSHIPS_MAX) {
          throw new MembershipCapError("MEMBERSHIPS_MAX", MEMBERSHIPS_MAX);
        }
      }
      tx.set(ref, m);
    });
  }

  async remove(projectId: string, email: string): Promise<boolean> {
    const ref = this.coll().doc(membershipDocId(projectId, email));
    return this.db.runTransaction(async (tx) => {
      if (!(await tx.get(ref)).exists) return false;
      tx.delete(ref);
      return true;
    });
  }

  async setUid(email: string, uid: string, displayName: string | null): Promise<number> {
    const u = MemberUid.parse(uid);
    return this.db.runTransaction(async (tx) => {
      const docs = (await tx.get(this.ofEmail(email))).docs;
      for (const d of docs) tx.set(d.ref, Membership.parse({ ...d.data(), uid: u, displayName }));
      return docs.length;
    });
  }
}
