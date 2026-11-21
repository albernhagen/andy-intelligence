// ── ModelGateway ─────────────────────────────────────────────────────────────
// One model completion, no tools, no streaming (AI-250: M10.10, ADR-0129). Paid: callers reserve
// spend before calling (M10.11: Direct-call steps on the gateway does that behind the spend gate);
// this port only calls. The reply text is untrusted model output: data, never instructions.

export type ModelRole = "system" | "user" | "assistant";

export interface ModelMessage {
  role: ModelRole;
  content: string;
}

export interface ModelRequest {
  /** The provider's model id. */
  model: string;
  messages: ModelMessage[];
  /** Always sent as the provider's output cap; at most `MODEL_MAX_OUTPUT_TOKENS`. */
  maxOutputTokens: number;
  /** Stop waiting after this long; defaults to, and is capped at, `MODEL_TIMEOUT_MS`. */
  timeoutMs?: number;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from the provider's prompt cache (part of `inputTokens`). */
  cachedTokens: number;
  /** The provider's reported cost for the call; null when it reported none. */
  costUsd: number | null;
}

/**
 * - `ok`: the model answered; `usage` is null when the response carried none (the spend gate
 *   then settles the full reservation, ADR-0129).
 * - `off`: no key is configured; nothing was sent.
 * - `error`: refused before sending (bad request), or a provider status, timeout, network failure
 *   or unreadable response. Nothing usable came back.
 */
export type ModelResult =
  | { outcome: "ok"; text: string; usage: ModelUsage | null }
  | { outcome: "off" }
  | { outcome: "error"; status: number | null; reason: string };

export interface ModelGateway {
  complete(request: ModelRequest): Promise<ModelResult>;
}

/** Longest any completion may run (ADR-0028). */
export const MODEL_TIMEOUT_MS = 60_000;
/** Largest output cap a request may set. */
export const MODEL_MAX_OUTPUT_TOKENS = 32_000;
/** Messages per request. */
export const MODEL_MAX_MESSAGES = 50;
/** Total characters across a request's messages (~200k tokens). */
export const MODEL_MAX_INPUT_CHARS = 800_000;

/** Why `request` is refused before any call, or null. Shared by every adapter and the fake. */
export function modelRequestRefusal(request: ModelRequest): string | null {
  if (!request.model.trim()) return "no model";
  if (
    !Number.isInteger(request.maxOutputTokens) ||
    request.maxOutputTokens < 1 ||
    request.maxOutputTokens > MODEL_MAX_OUTPUT_TOKENS
  ) {
    return `maxOutputTokens must be 1 to ${MODEL_MAX_OUTPUT_TOKENS}`;
  }
  if (request.messages.length === 0) return "no messages";
  if (request.messages.length > MODEL_MAX_MESSAGES) return "too many messages";
  const chars = request.messages.reduce((n, m) => n + m.content.length, 0);
  if (chars > MODEL_MAX_INPUT_CHARS) return "input too large";
  if (request.timeoutMs !== undefined && !(request.timeoutMs > 0)) return "timeoutMs must be > 0";
  return null;
}

/** The timeout a call uses: the request's, capped at `MODEL_TIMEOUT_MS`. */
export function modelTimeoutMs(request: ModelRequest): number {
  return Math.min(request.timeoutMs ?? MODEL_TIMEOUT_MS, MODEL_TIMEOUT_MS);
}
