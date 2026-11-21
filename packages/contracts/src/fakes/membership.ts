import {
  MEMBERSHIPS_MAX,
  MEMBERS_PER_PROJECT_MAX,
  MemberEmail,
  MemberUid,
  Membership,
  MembershipCapError,
  MembershipProjectId,
  type MembershipInput,
  byMemberEmail,
  byMembershipProject,
} from "../entities/membership";
import type { MembershipStore } from "../ports/membership";

const key = (projectId: string, email: string) => `${projectId}\u0000${email}`;

/** In-memory MembershipStore: synchronous updates, so atomic within one process. */
export class InMemoryMembershipStore implements MembershipStore {
  private readonly rows = new Map<string, Membership>();

  async listForEmail(email: string): Promise<Membership[]> {
    const e = MemberEmail.parse(email);
    return this.all()
      .filter((m) => m.email === e)
      .sort(byMembershipProject);
  }

  async listForProject(projectId: string): Promise<Membership[]> {
    const p = MembershipProjectId.parse(projectId);
    return this.all()
      .filter((m) => m.projectId === p)
      .sort(byMemberEmail);
  }

  async get(projectId: string, email: string): Promise<Membership | null> {
    const m = this.rows.get(key(MembershipProjectId.parse(projectId), MemberEmail.parse(email)));
    return m ? structuredClone(m) : null;
  }

  async put(membership: MembershipInput): Promise<void> {
    const m = Membership.parse(membership);
    const k = key(m.projectId, m.email);
    if (!this.rows.has(k)) {
      const inProject = [...this.rows.values()].filter((r) => r.projectId === m.projectId).length;
      if (inProject >= MEMBERS_PER_PROJECT_MAX) {
        throw new MembershipCapError("MEMBERS_PER_PROJECT_MAX", MEMBERS_PER_PROJECT_MAX);
      }
      if (this.rows.size >= MEMBERSHIPS_MAX) {
        throw new MembershipCapError("MEMBERSHIPS_MAX", MEMBERSHIPS_MAX);
      }
    }
    this.rows.set(k, m);
  }

  async remove(projectId: string, email: string): Promise<boolean> {
    return this.rows.delete(key(MembershipProjectId.parse(projectId), MemberEmail.parse(email)));
  }

  async setUid(email: string, uid: string, displayName: string | null): Promise<number> {
    const e = MemberEmail.parse(email);
    const u = MemberUid.parse(uid);
    let n = 0;
    for (const [k, m] of this.rows) {
      if (m.email !== e) continue;
      this.rows.set(k, Membership.parse({ ...m, uid: u, displayName }));
      n++;
    }
    return n;
  }

  private all(): Membership[] {
    return [...this.rows.values()].map((m) => structuredClone(m));
  }
}
