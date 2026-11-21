import { z } from "zod";

/**
 * What the spend notices have sent (AI-257: M10.9): dedupe keys for the current UTC day and
 * month and the day's count, so a notice goes out once per cap and window and at most a fixed
 * number a day, across instances and restarts. One record for the control plane.
 */
export const SPEND_NOTICE_KEYS_MAX = 200;

export const SpendNoticeState = z.object({
  /** UTC date the count belongs to. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sentToday: z.number().int().min(0),
  /** `kind|cap|scope|window` keys already sent. */
  sent: z.array(z.string().min(1).max(200)).max(SPEND_NOTICE_KEYS_MAX),
});
export type SpendNoticeState = z.infer<typeof SpendNoticeState>;
