import { z } from "zod";
import { Timestamp } from "./common";

/**
 * Project members (M8: Project members, design ADR-0127). Storage shapes only: nothing reads a
 * membership yet; sign-in (M8.5) and the role table in `can` (M8.4) will.
 */

/** A member's role on one project. The owner (the `ALLOWED_EMAILS` allow-list) is not a membership. */
export const MemberRole = z.enum(["contributor", "viewer"]);
export type MemberRole = z.infer<typeof MemberRole>;

/** Members one project may hold (ADR-0028). */
export const MEMBERS_PER_PROJECT_MAX = 20;
/** Memberships across all projects (ADR-0028). */
export const MEMBERSHIPS_MAX = 100;

/** A project id as stored: it is also a Firestore document path segment, so no `/`. */
export const MembershipProjectId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^/]+$/);

/** An email, trimmed and lower-cased on parse, so lookups don't depend on how it was typed. */
export const MemberEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** A signed-in user's auth uid; the charset keeps it safe as a storage key. */
export const MemberUid = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

/**
 * One person's access to one project; unique per (projectId, email). `uid` and `displayName`
 * are null until the member first signs in (`setUid`). Only the owner adds members, so
 * `addedBy` is the owner's actor: `user:<uid>`, or `andy` from before AI-19; never an email.
 */
export const Membership = z.object({
  projectId: MembershipProjectId,
  email: MemberEmail,
  role: MemberRole,
  uid: MemberUid.nullable(),
  /** From the member's Google account at sign-in; untrusted, display only. */
  displayName: z.string().max(200).nullable(),
  addedBy: z.string().regex(/^(andy|user:[A-Za-z0-9_-]{1,128})$/),
  addedAt: Timestamp,
});
export type Membership = z.infer<typeof Membership>;
/** What callers pass to `put`: the email may still carry capitals or spaces. */
export type MembershipInput = z.input<typeof Membership>;

/** Refused because a cap (ADR-0028) is full; `cap` names it. Never carries an email. */
export class MembershipCapError extends Error {
  constructor(
    readonly cap: "MEMBERS_PER_PROJECT_MAX" | "MEMBERSHIPS_MAX",
    limit: number,
  ) {
    super(
      cap === "MEMBERS_PER_PROJECT_MAX"
        ? `project already has ${limit} members (MEMBERS_PER_PROJECT_MAX)`
        : `already ${limit} memberships across all projects (MEMBERSHIPS_MAX)`,
    );
    this.name = "MembershipCapError";
  }
}

/** listForProject's order: by email. */
export const byMemberEmail = (a: Membership, b: Membership) => a.email.localeCompare(b.email);
/** listForEmail's order: by project id. */
export const byMembershipProject = (a: Membership, b: Membership) =>
  a.projectId.localeCompare(b.projectId);
