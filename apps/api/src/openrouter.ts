import {
  modelRequestRefusal,
  modelTimeoutMs,
  type ModelGateway,
  type ModelRequest,
  type ModelResult,
  type ModelUsage,
} from "@andy/contracts";
import { z } from "zod";

/**
 * The `ModelGateway` port's OpenRouter adapter (AI-250: M10.10, ADR-0129). One chat completion
 * per call over `fetch`; no tools, no streaming. Not wired to any step: M10.11 calls it behind the
 * spend gate, and nothing can call out until the key exists (AI-266: M10.15).
 *
 * The key is read at call time from a secret by name, never from the request, and never logged.
 * The response body is untrusted: it is size-capped, schema-checked, and only the reply text and
 * usage numbers leave this file.
 */

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/** Secret Manager secret ID for the key (created by Andy in AI-266: M10.15). */
export const OPENROUTER_KEY_SECRET = "openrouter-api-key";
/** Largest response body read; past it the call is an error (ADR-0028). */
export const OPENROUTER_MAX_RESPONSE_BYTES = 1_048_576;

export interface OpenRouterConfig {
  /** The key, read fresh on each call; null or blank means no key (the call is `off`). */
  readKey: () => Promise<string | null>;
  /** Test seam: the HTTP client. Tests pass a mock; nothing in CI reaches the network. */
  fetch?: typeof fetch;
}

const log = (severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object) =>
  console.log(JSON.stringify({ severity, message, component: "openrouter", ...fields }));

/** The OpenAI-compatible response fields we read; everything else is ignored. */
const Completion = z.object({
  /** OpenRouter can report a failure inside an HTTP 200 body. */
  error: z.unknown().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
      prompt_tokens_details: z
        .object({ cached_tokens: z.number().int().nonnegative().nullish() })
        .nullish(),
      cost: z.number().nonnegative().nullish(),
    })
    .nullish(),
});

type Attempt =
  { kind: "answered"; status: number; body: string } | { kind: "failed"; reason: string };

export class OpenRouterGateway implements ModelGateway {
  private readonly fetch: typeof fetch;

  constructor(private readonly config: OpenRouterConfig) {
    this.fetch = config.fetch ?? globalThis.fetch;
  }

  async complete(request: ModelRequest): Promise<ModelResult> {
    const refused = modelRequestRefusal(request);
    if (refused) {
      log("WARNING", "model call refused", { model: request.model, reason: refused });
      return { outcome: "error", status: null, reason: refused };
    }

    let key: string | null;
    try {
      key = (await this.config.readKey())?.trim() || null;
    } catch {
      // Fail closed: an unreadable secret is an error, not "no key" (ADR-0129).
      log("ERROR", "model call failed", { model: request.model, reason: "cannot read key" });
      return { outcome: "error", status: null, reason: "cannot read key" };
    }
    if (!key) {
      log("WARNING", "model call off: no OpenRouter key", { model: request.model });
      return { outcome: "off" };
    }

    // One deadline for the whole call, retry included (at most MODEL_MAX_ATTEMPTS requests).
    const signal = AbortSignal.timeout(modelTimeoutMs(request));
    const body = JSON.stringify({
      model: request.model,
      messages: request.messages,
      max_tokens: request.maxOutputTokens,
      usage: { include: true },
    });

    let attempt = await this.send(key, body, signal);
    if (attempt.kind === "answered" && attempt.status >= 500) {
      log("WARNING", "model call retried", { model: request.model, status: attempt.status });
      attempt = await this.send(key, body, signal);
    }
    return this.resultOf(request.model, attempt);
  }

  private async send(key: string, body: string, signal: AbortSignal): Promise<Attempt> {
    try {
      const res = await this.fetch(OPENROUTER_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body,
        redirect: "error",
        signal,
      });
      const text = await readCapped(res, OPENROUTER_MAX_RESPONSE_BYTES);
      if (text === null) return { kind: "failed", reason: "response too large" };
      return { kind: "answered", status: res.status, body: text };
    } catch (err) {
      const name = (err as Error).name;
      return {
        kind: "failed",
        reason: name === "TimeoutError" || name === "AbortError" ? "timed out" : "request failed",
      };
    }
  }

  private resultOf(model: string, attempt: Attempt): ModelResult {
    if (attempt.kind === "failed") {
      log("ERROR", "model call failed", { model, reason: attempt.reason });
      return { outcome: "error", status: null, reason: attempt.reason };
    }
    const { status } = attempt;
    if (status < 200 || status >= 300) {
      // The provider's error body is not logged or returned: it may echo the request.
      log("ERROR", "model call refused by provider", { model, status });
      return { outcome: "error", status, reason: `provider answered ${status}` };
    }
    let parsed: z.infer<typeof Completion>;
    try {
      parsed = Completion.parse(JSON.parse(attempt.body));
    } catch {
      log("ERROR", "model call failed", { model, status, reason: "unreadable response" });
      return { outcome: "error", status, reason: "unreadable response" };
    }
    if (parsed.error !== undefined && parsed.error !== null) {
      log("ERROR", "model call failed", { model, status, reason: "provider error" });
      return { outcome: "error", status, reason: "provider error" };
    }
    const text = parsed.choices[0]?.message.content;
    if (!text) {
      // Content-filtered or cut off before any text: not an answer, so settle as unknown.
      log("ERROR", "model call failed", { model, status, reason: "empty response" });
      return { outcome: "error", status, reason: "empty response" };
    }
    const usage = usageOf(parsed.usage);
    log("INFO", "model call done", { model, status, ...(usage ?? { usage: null }) });
    return { outcome: "ok", text, usage };
  }
}

function usageOf(usage: z.infer<typeof Completion>["usage"]): ModelUsage | null {
  if (!usage) return null;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    costUsd: usage.cost ?? null,
  };
}

/** The body as text, or null once it passes `maxBytes` (the rest is not read). */
async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
