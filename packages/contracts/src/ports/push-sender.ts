// ── PushSender ───────────────────────────────────────────────────────────────
// Sends one Web Push message to one browser subscription (AI-178, M7.9, ADR-0052). What to send
// and when (categories, caps, quiet hours) is decided elsewhere (M7.8: Push policy); this port
// only delivers. The subscription type is minimal until `PushSubscriptionStore` (M7.7) lands.

/** Where a push goes: the browser's push-service URL and its encryption keys (base64url). */
export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** The Web Push `Urgency` header values (RFC 8030 §5.3). */
export type PushUrgency = "very-low" | "low" | "normal" | "high";

export interface PushMessage {
  /** The plaintext payload; encrypted per subscription before it leaves the control plane. */
  payload: string;
  urgency: PushUrgency;
  /** How long the push service may hold the message; the adapter applies a default and a cap. */
  ttlSeconds?: number;
}

/**
 * - `sent`: the push service accepted it.
 * - `gone`: the subscription is dead (HTTP 404 or 410); the caller deletes it.
 * - `error`: anything else (other status, timeout, network, bad keys, payload too large).
 * - `off`: push isn't configured; nothing was sent.
 * - `capped`: the sender's own hourly cap was reached; nothing was sent.
 */
export type PushSendResult =
  | { outcome: "sent"; status: number }
  | { outcome: "gone"; status: number }
  | { outcome: "error"; status: number | null; reason: string }
  | { outcome: "off" }
  | { outcome: "capped" };

export interface PushSender {
  /** False when push isn't configured: every send returns `off`. */
  readonly enabled: boolean;
  send(target: PushTarget, message: PushMessage): Promise<PushSendResult>;
}

/** The result for a push service's HTTP status: 2xx sent, 404 or 410 gone, anything else error. */
export function pushResultForStatus(status: number): PushSendResult {
  if (status >= 200 && status < 300) return { outcome: "sent", status };
  if (status === 404 || status === 410) return { outcome: "gone", status };
  return { outcome: "error", status, reason: `push service answered ${status}` };
}
