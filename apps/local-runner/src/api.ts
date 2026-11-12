import {
  RUN_REPORT_MAX_BYTES,
  RunContextResponse,
  RunHeartbeatResponse,
  RunReportRequest,
  RunReportResponse,
  RunnerClaimResponse,
  type RunPhase,
} from "@andy/contracts";
import { LOCAL_LIMITS } from "./config";

/**
 * The runner's calls to the control plane (ADR-0089): the claim with the runner secret, then the
 * task's context, heartbeat and report with its per-run token. Plain HTTPS, outbound only.
 * Tokens go in the Authorization header and nowhere else; errors never include them.
 */

export type ClaimResult =
  | { kind: "ok"; response: RunnerClaimResponse }
  /** 429: claimed too soon or rate-limited; wait this long. */
  | { kind: "wait"; seconds: number }
  /** 401: the secret is unknown, revoked or expired. */
  | { kind: "unauthorized" }
  /** Network error, 5xx or an unexpected answer: try again at the next poll. */
  | { kind: "error"; reason: string };

export type HeartbeatResult =
  | { kind: "ok"; cancel: boolean }
  /** 409 (run_finished: lease lost, deadline, already reported) or 401/403/404 (token dead). */
  | { kind: "ended"; status: number }
  | { kind: "error"; reason: string };

export type ReportResult =
  | { kind: "ok"; result: RunReportResponse["result"] }
  | { kind: "rejected"; status: number; reason: string }
  | { kind: "error"; reason: string };

export type PushTokenResult =
  | { kind: "ok"; token: string }
  /** 401/403/404/409: the grant was refused (already used, run ended, revoked). */
  | { kind: "refused"; status: number; reason: string }
  | { kind: "error"; reason: string };

export interface ApiOptions {
  origin: string;
  version: string;
  fetch?: typeof fetch;
  /** Per request. */
  timeoutMs?: number;
  /** Waits between report attempts; tests pass 0. */
  retryDelayMs?: number;
}

export class ControlPlane {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(private readonly options: ApiOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retryDelayMs = options.retryDelayMs ?? 5_000;
  }

  private async call(
    path: string,
    token: string,
    init: { method: "GET" | "POST"; body?: unknown },
  ): Promise<{ status: number; json: unknown; retryAfter: string | null }> {
    const res = await this.fetchImpl(`${this.options.origin}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: "error",
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text === "" ? null : JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, retryAfter: res.headers.get("retry-after") };
  }

  async claim(secret: string): Promise<ClaimResult> {
    try {
      const res = await this.call("/runner/claim", secret, {
        method: "POST",
        body: { version: this.options.version },
      });
      if (res.status === 401) return { kind: "unauthorized" };
      if (res.status === 429) {
        const seconds = Number.parseInt(res.retryAfter ?? "", 10);
        return { kind: "wait", seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 10 };
      }
      if (res.status !== 200) return { kind: "error", reason: `claim answered HTTP ${res.status}` };
      const parsed = RunnerClaimResponse.safeParse(res.json);
      if (!parsed.success) return { kind: "error", reason: "claim answer has an unexpected shape" };
      return { kind: "ok", response: parsed.data };
    } catch (err) {
      return { kind: "error", reason: `claim failed: ${networkReason(err)}` };
    }
  }

  /** The task's instructions, checked like the Actions executor's `context` job. */
  async context(runId: string, token: string): Promise<RunContextResponse> {
    let res;
    try {
      res = await this.call(`/runs/${runId}/context`, token, { method: "GET" });
    } catch (err) {
      throw new Error(`context failed: ${networkReason(err)}`, { cause: err });
    }
    if (res.status !== 200) throw new Error(`context answered HTTP ${res.status}`);
    const parsed = RunContextResponse.safeParse(res.json);
    if (!parsed.success) throw new Error("context answer has an unexpected shape");
    return checkContext(parsed.data, runId);
  }

  async heartbeat(runId: string, token: string, phase: RunPhase): Promise<HeartbeatResult> {
    try {
      const res = await this.call(`/runs/${runId}/heartbeat`, token, {
        method: "POST",
        body: { phase },
      });
      if ([401, 403, 404, 409].includes(res.status)) return { kind: "ended", status: res.status };
      if (res.status !== 200)
        return { kind: "error", reason: `heartbeat answered HTTP ${res.status}` };
      const parsed = RunHeartbeatResponse.safeParse(res.json);
      if (!parsed.success)
        return { kind: "error", reason: "heartbeat answer has an unexpected shape" };
      return { kind: "ok", cancel: parsed.data.cancel };
    } catch (err) {
      return { kind: "error", reason: `heartbeat failed: ${networkReason(err)}` };
    }
  }

  /**
   * The run's one push token (ADR-0089: `POST /github/token` with the per-run token). Never
   * retried: a second request is refused by design. The token is returned, never logged or
   * put in a reason.
   */
  async pushToken(runId: string, token: string): Promise<PushTokenResult> {
    try {
      const res = await this.call("/github/token", token, { method: "POST", body: { runId } });
      if (res.status !== 200) {
        return { kind: "refused", status: res.status, reason: errorField(res.json) };
      }
      const value = (res.json as { token?: unknown } | null)?.token;
      if (typeof value !== "string" || !/^\S{8,4096}$/.test(value)) {
        return { kind: "error", reason: "the push token answer has an unexpected shape" };
      }
      return { kind: "ok", token: value };
    } catch (err) {
      return { kind: "error", reason: `push token request failed: ${networkReason(err)}` };
    }
  }

  /** Posts the report; retries a network error or 5xx, never a 4xx. */
  async report(runId: string, token: string, report: RunReportRequest): Promise<ReportResult> {
    const body = fitReport(RunReportRequest.parse(report));
    let last = "";
    for (let attempt = 1; attempt <= LOCAL_LIMITS.reportAttempts; attempt += 1) {
      try {
        const res = await this.call(`/runs/${runId}/report`, token, { method: "POST", body });
        if (res.status === 200) {
          const parsed = RunReportResponse.safeParse(res.json);
          if (parsed.success) return { kind: "ok", result: parsed.data.result };
          return { kind: "rejected", status: 200, reason: "report answer has an unexpected shape" };
        }
        if (res.status < 500 && res.status !== 429) {
          return { kind: "rejected", status: res.status, reason: errorField(res.json) };
        }
        last = `report answered HTTP ${res.status}`;
      } catch (err) {
        last = `report failed: ${networkReason(err)}`;
      }
      if (attempt < LOCAL_LIMITS.reportAttempts) await sleep(this.retryDelayMs * attempt);
    }
    return { kind: "error", reason: last };
  }
}

const MODEL_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const STEP_SHAPE = /^[a-z][a-z-]{0,31}$/;

/** The same bounds the Actions executor's `context` job enforces (ADR-0028). */
export function checkContext(context: RunContextResponse, runId: string): RunContextResponse {
  if (context.runId !== runId) throw new Error("context is for another agent task");
  if (!STEP_SHAPE.test(context.step)) throw new Error("context step has an unexpected shape");
  if (!MODEL_SHAPE.test(context.model)) throw new Error("context model has an unexpected shape");
  if (context.maxTurns > LOCAL_LIMITS.maxTurns)
    throw new Error(
      `context asks for ${context.maxTurns} turns; the cap is ${LOCAL_LIMITS.maxTurns}`,
    );
  if (context.prompt.length > LOCAL_LIMITS.maxPromptChars)
    throw new Error("context prompt is over the size cap");
  return context;
}

/**
 * Keeps the body under the control plane's cap (RUN_REPORT_MAX_BYTES): drops the structured
 * output first, then shortens the summary. The platform's report builder already caps both, so
 * this only guards against a drift between the two.
 */
export function fitReport(report: RunReportRequest): RunReportRequest {
  const size = (r: RunReportRequest) => Buffer.byteLength(JSON.stringify(r), "utf8");
  if (size(report) <= RUN_REPORT_MAX_BYTES) return report;
  let fitted: RunReportRequest = { ...report, output: undefined };
  if (size(fitted) > RUN_REPORT_MAX_BYTES && fitted.summary) {
    fitted = { ...fitted, summary: `${fitted.summary.slice(0, 4000)}…` };
  }
  if (size(fitted) > RUN_REPORT_MAX_BYTES)
    fitted = { ...fitted, rateLimits: undefined, usage: undefined };
  return fitted;
}

function errorField(json: unknown): string {
  if (json && typeof json === "object" && "error" in json) return String(json.error).slice(0, 300);
  return "no error message";
}

/** A network error without its message's details beyond the cause (no URL with secrets: none is ever in one). */
function networkReason(err: unknown): string {
  if (err instanceof Error)
    return err.name === "TimeoutError" ? "timed out" : err.message.slice(0, 200);
  return String(err).slice(0, 200);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
