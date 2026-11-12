import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ClaimedRun,
  RUNNER_LIMITS,
  RunHeartbeatRequest,
  RunReportRequest,
  RunnerClaimRequest,
  type RunContextResponse,
} from "@andy/contracts";

/**
 * A fake control plane for the runner's four calls, checking each request against the contract
 * schemas and the right credential (runner secret on the claim, per-run token on the rest).
 */

export const SECRET = `air_${"a".repeat(43)}`;

export interface FakeTask {
  claim: ClaimedRun;
  context: RunContextResponse;
  /** The heartbeat answer for the runner's phase: "cancel" → cancel: true, 409 → run_finished. */
  heartbeat?: (phase: string | undefined) => "ok" | "cancel" | 409;
}

export interface FakeServer {
  origin: string;
  claims: { at: number; body: unknown; auth: string | null }[];
  contexts: string[];
  heartbeats: { runId: string; body: unknown }[];
  reports: { runId: string; body: RunReportRequest }[];
  /** Any request the fake refused (bad schema or credential): a test expects none. */
  refused: string[];
  queue: FakeTask[];
  /** The next claim answers 401 when set. */
  revoked: boolean;
  /** Each claim answers this many seconds (the contract's minimum is 1). */
  pollSeconds: number;
  heartbeatSeconds: number;
  close(): Promise<void>;
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? {} : JSON.parse(text);
}

export async function startFakeServer(): Promise<FakeServer> {
  const tasks = new Map<string, FakeTask>();
  const state: Omit<FakeServer, "origin" | "close"> = {
    claims: [],
    contexts: [],
    heartbeats: [],
    reports: [],
    refused: [],
    queue: [],
    revoked: false,
    pollSeconds: 1,
    heartbeatSeconds: 1,
  };

  const server: Server = createServer((req, res) => {
    const send = (status: number, json: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    };
    const auth = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1] ?? null;
    void (async () => {
      const url = new URL(req.url ?? "/", "http://fake");
      const data = await body(req);
      if (req.method === "POST" && url.pathname === "/runner/claim") {
        state.claims.push({ at: Date.now(), body: data, auth });
        if (state.revoked || auth !== SECRET) return send(401, { error: "unauthenticated" });
        if (!RunnerClaimRequest.safeParse(data).success) {
          state.refused.push("claim body");
          return send(400, { error: "invalid request" });
        }
        const next = state.queue.shift() ?? null;
        if (next) tasks.set(next.claim.runId, next);
        return send(200, {
          run: next ? ClaimedRun.parse(next.claim) : null,
          pollSeconds: state.pollSeconds,
          heartbeatSeconds: state.heartbeatSeconds,
        });
      }
      const match = /^\/runs\/([A-Za-z0-9-]+)\/(context|heartbeat|report)$/.exec(url.pathname);
      const task = match ? tasks.get(match[1]!) : undefined;
      if (!match || !task) return send(404, { error: "not found" });
      if (auth !== task.claim.token) {
        state.refused.push(`${match[2]} token`);
        return send(401, { error: "unauthenticated" });
      }
      const runId = match[1]!;
      if (match[2] === "context" && req.method === "GET") {
        state.contexts.push(runId);
        return send(200, task.context);
      }
      if (match[2] === "heartbeat" && req.method === "POST") {
        if (!RunHeartbeatRequest.safeParse(data).success) state.refused.push("heartbeat body");
        state.heartbeats.push({ runId, body: data });
        const phase = (data as { phase?: string }).phase;
        const answer = task.heartbeat?.(phase) ?? "ok";
        if (answer === 409) return send(409, { error: "run_finished" });
        return send(200, {
          cancel: answer === "cancel",
          leaseExpiresAt:
            answer === "cancel"
              ? null
              : new Date(Date.now() + RUNNER_LIMITS.leaseSeconds * 1000).toISOString(),
        });
      }
      if (match[2] === "report" && req.method === "POST") {
        const parsed = RunReportRequest.safeParse(data);
        if (!parsed.success) {
          state.refused.push("report body");
          return send(400, { error: "invalid request" });
        }
        const duplicate = state.reports.some((r) => r.runId === runId);
        state.reports.push({ runId, body: parsed.data });
        return send(200, {
          result: duplicate || parsed.data.status === "cancelled" ? "duplicate" : "recorded",
        });
      }
      return send(404, { error: "not found" });
    })().catch((err: unknown) => send(500, { error: String(err) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const fake = Object.assign(state, {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
  return fake;
}
