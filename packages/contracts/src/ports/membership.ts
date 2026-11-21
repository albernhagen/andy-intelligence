import type { Membership, MembershipInput } from "../entities/membership";

// ── MembershipStore ──────────────────────────────────────────────────────────
// Project memberships (M8.2, ADR-0127). Storage only: nothing reads it yet (M8.4, M8.5).
// Emails are lower-cased on the way in, so every lookup is case-insensitive. Reads are bounded
// by the caps (MEMBERS_PER_PROJECT_MAX, MEMBERSHIPS_MAX). Errors never carry an email.

export interface MembershipStore {
  /** The email's memberships, by project id. */
  listForEmail(email: string): Promise<Membership[]>;
  /** The project's memberships, by email. */
  listForProject(projectId: string): Promise<Membership[]>;
  /** The membership, or null. */
  get(projectId: string, email: string): Promise<Membership | null>;
  /**
   * Stores the membership, replacing any for the same project and email. A new one past
   * MEMBERS_PER_PROJECT_MAX in its project or MEMBERSHIPS_MAX in all throws a
   * MembershipCapError. Atomic: concurrent puts can't pass a cap.
   */
  put(membership: MembershipInput): Promise<void>;
  /** Deletes the membership; false when there was none. */
  remove(projectId: string, email: string): Promise<boolean>;
  /** Records the member's uid and name on every membership of the email; returns how many. */
  setUid(email: string, uid: string, displayName: string | null): Promise<number>;
}
