import { z } from "zod";
import { Id, Timestamp } from "./common";

/** Email notifications for the Needs-you inbox (AI-77, ADR-0060). */

/** Spread into `Project`: email for this project's Needs-you items; on by default once configured. */
export const projectNotifyFields = {
  emailNotifications: z.boolean().default(true),
};

/** Spread into `ProjectPatch`: no default, so a patch of another switch can't reset it. */
export const projectNotifyPatch = {
  emailNotifications: z.boolean().optional(),
};

/** Items one batch email holds by name; later ones in the same window are only counted. */
export const NOTIFY_PENDING_MAX = 20;

/** One Needs-you item waiting in the batching window. `title` and `line` are untrusted text. */
export const PendingNotice = z.object({
  projectId: Id,
  ticketId: Id,
  /** A ticket key, or `<PROJECT>-plan` for a project plan waiting for Andy (AI-108). */
  key: z.string().regex(/^[A-Z][A-Z0-9]{0,9}-(\d+|plan)$/),
  title: z.string().max(300),
  /** The question line, or why the ticket waits. */
  line: z.string().max(300),
  link: z.url(),
});
export type PendingNotice = z.infer<typeof PendingNotice>;

/**
 * The email ledger: the day's count and the open batching window. Stored, so the cap survives
 * restarts and scale-to-zero. `day` is the UTC date the count belongs to.
 */
export const EmailNotifyState = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Emails sent that day, the "more waiting" one excluded. */
  sent: z.number().int().min(0),
  /** The day's one "more waiting" email went out; nothing more until the next day. */
  overflowSent: z.boolean(),
  pending: z.array(PendingNotice).max(NOTIFY_PENDING_MAX),
  /** Items that arrived while `pending` was full: counted, not named. */
  pendingExtra: z.number().int().min(0),
  /** When the open window's batch is due; null: no window open. */
  windowEndsAt: Timestamp.nullable(),
});
export type EmailNotifyState = z.infer<typeof EmailNotifyState>;
