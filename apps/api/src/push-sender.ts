import {
  isPushServiceEndpoint,
  pushResultForStatus,
  type PushMessage,
  type PushSendResult,
  type PushSender,
  type PushTarget,
} from "@andy/contracts";
import webpush from "web-push";

/**
 * The `PushSender` port's Web Push adapter (AI-178, M7.9, ADR-0052). The `web-push` library only
 * encrypts the payload (aes128gcm) and signs the VAPID header; the request itself goes out with
 * `fetch`, so the timeout, the redirect rule and the hourly cap are ours. What to send and when is
 * decided by the push policy (M7.8); this file only delivers.
 */

/** One push may take this long, so a slow push service can't hold the request it runs in. */
export const PUSH_SEND_TIMEOUT_MS = 10_000;
/** How long a push service may hold a message for an offline device, unless the caller asks less. */
export const PUSH_DEFAULT_TTL_SECONDS = 3_600;
/** Longest TTL a caller may ask for: a day-old notice is stale (the inbox and email keep it). */
export const PUSH_MAX_TTL_SECONDS = 86_400;
/** Plaintext payload cap; Web Push allows 4096 bytes once encrypted, padding included. */
export const PUSH_MAX_PAYLOAD_BYTES = 3_072;
/**
 * Sends per instance per clock hour (ADR-0028), a backstop over the policy's own caps (ADR-0115
 * Q3: 6 an hour). Past it every send returns `capped` until the next hour.
 */
export const MAX_PUSH_SENDS_PER_HOUR = 60;
/** The VAPID subject: the control plane's public URL, no email address (ADR-0015). */
export const VAPID_SUBJECT = "https://ai.andybernhagen.com";

export interface PushConfig {
  /** VAPID key pair, base64url, as `web-push generate-vapid-keys` prints them. */
  publicKey: string;
  privateKey: string;
  /**
   * Test seam: a plain-HTTP fake push service at this origin (e.g. `http://127.0.0.1:1234`),
   * allowed besides the push-service hosts. Never set in production.
   */
  testOrigin?: string;
  /** Test seams: a shorter timeout, a clock. */
  timeoutMs?: number;
  now?: () => Date;
}

const log = (severity: "INFO" | "WARNING" | "ERROR", message: string, fields: object) =>
  console.log(JSON.stringify({ severity, message, component: "push-sender", ...fields }));

/**
 * The VAPID keys from the environment, or null when either is missing: then push is off, logged
 * once here at start. Both come from Secret Manager once M7.10: VAPID key secret is applied.
 */
export function pushConfigFromEnv(env: NodeJS.ProcessEnv): PushConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (publicKey && privateKey) return { publicKey, privateKey };
  const missing = [!publicKey && "VAPID_PUBLIC_KEY", !privateKey && "VAPID_PRIVATE_KEY"].filter(
    Boolean,
  );
  log("WARNING", "push not configured: Web Push is off", { missing });
  return null;
}

/** The sender for this config: Web Push when configured, else one that is off. */
export function pushSenderFor(config: PushConfig | null): PushSender {
  return config ? new WebPushSender(config) : new DisabledPushSender();
}

/** Push isn't configured: reports itself off and sends nothing. */
export class DisabledPushSender implements PushSender {
  readonly enabled = false;
  async send(): Promise<PushSendResult> {
    return { outcome: "off" };
  }
}

/** Only the push service's host is logged: the endpoint's path identifies the device. */
const hostOf = (endpoint: string) => {
  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
};

export class WebPushSender implements PushSender {
  readonly enabled = true;
  private hour = "";
  private sentThisHour = 0;

  constructor(private readonly config: PushConfig) {}

  async send(target: PushTarget, message: PushMessage): Promise<PushSendResult> {
    const host = hostOf(target.endpoint);
    const refused = this.refusal(target, message);
    if (refused) {
      log("WARNING", "push not sent", { host, reason: refused });
      return { outcome: "error", status: null, reason: refused };
    }
    if (!this.takeSlot()) {
      log("WARNING", "push capped", { host, cap: MAX_PUSH_SENDS_PER_HOUR });
      return { outcome: "capped" };
    }

    let request: webpush.RequestDetails & { body: Buffer };
    try {
      request = webpush.generateRequestDetails(target, message.payload, {
        vapidDetails: {
          subject: VAPID_SUBJECT,
          publicKey: this.config.publicKey,
          privateKey: this.config.privateKey,
        },
        TTL: ttlOf(message),
        urgency: message.urgency,
        contentEncoding: "aes128gcm",
      });
    } catch (err) {
      // Bad subscription keys or VAPID keys; the library's message names neither key's value.
      const reason = `cannot encrypt: ${(err as Error).message}`.slice(0, 200);
      log("ERROR", "push not sent", { host, reason });
      return { outcome: "error", status: null, reason };
    }

    let status: number;
    try {
      const res = await fetch(request.endpoint, {
        method: "POST",
        headers: headersOf(request.headers),
        body: request.body,
        redirect: "error",
        signal: AbortSignal.timeout(this.config.timeoutMs ?? PUSH_SEND_TIMEOUT_MS),
      });
      status = res.status;
      await res.body?.cancel();
    } catch (err) {
      const reason = (err as Error).name === "TimeoutError" ? "timed out" : "request failed";
      log("ERROR", "push failed", { host, reason });
      return { outcome: "error", status: null, reason };
    }

    const result = pushResultForStatus(status);
    if (result.outcome === "error") log("ERROR", "push refused", { host, status });
    if (result.outcome === "gone") log("INFO", "push subscription gone", { host, status });
    return result;
  }

  /** Why the send is refused before any work, or null. */
  private refusal(target: PushTarget, message: PushMessage): string | null {
    if (!URL.canParse(target.endpoint)) return "invalid subscription";
    const testing =
      this.config.testOrigin !== undefined &&
      new URL(target.endpoint).origin === this.config.testOrigin;
    if (!testing && !isPushServiceEndpoint(target.endpoint))
      return "endpoint is not a push service";
    if (Buffer.byteLength(message.payload) > PUSH_MAX_PAYLOAD_BYTES) return "payload too large";
    return null;
  }

  /** Counts a send in the current clock hour; false once the hour's cap is reached. */
  private takeSlot(): boolean {
    const hour = (this.config.now?.() ?? new Date()).toISOString().slice(0, 13);
    if (hour !== this.hour) {
      this.hour = hour;
      this.sentThisHour = 0;
    }
    if (this.sentThisHour >= MAX_PUSH_SENDS_PER_HOUR) return false;
    this.sentThisHour++;
    return true;
  }
}

function ttlOf(message: PushMessage): number {
  const asked = Math.floor(message.ttlSeconds ?? PUSH_DEFAULT_TTL_SECONDS);
  return Math.min(PUSH_MAX_TTL_SECONDS, Math.max(0, asked));
}

/** String header values; `fetch` sets Content-Length from the body itself. */
function headersOf(headers: webpush.Headers): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => name.toLowerCase() !== "content-length")
      .map(([name, value]) => [name, String(value)]),
  );
}
