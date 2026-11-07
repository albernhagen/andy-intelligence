import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  DeliveryId,
  type CodeEventLog,
  type CodeHostEvent,
  type Project,
  type WorkTracker,
} from "@andy/contracts";
import { PullRequestTickets, projectForRepo, type TicketService } from "@andy/domain";
import {
  WebhookPayloadError,
  isRecordedEvent,
  toCodeHostEvent,
  verifySignature,
  webhookRepo,
} from "@andy/github";
import type { AuthEnv } from "../auth";
import { FixedWindowLimiter } from "../mcp/rate-limit";

/**
 * GitHub App webhook receiver (ADR-0041, ADR-0043: secret read from the connection). Order of checks: body cap → HMAC → rate cap →
 * event type → registered repo → record once by delivery ID → (pull requests, first delivery
 * only) move the linked ticket (AI-14). Nothing is stored before the signature checks out, and
 * only deliveries about registered repos are stored. The rate cap counts signed deliveries
 * only, so unsigned floods can't lock GitHub out.
 */

export const WEBHOOK_PATH = "/webhooks/github";
/** GitHub's own cap is 25 MB; PR/check/workflow payloads are tens of KB (ADR-0028). */
export const MAX_WEBHOOK_BYTES = 1024 * 1024;
/** Signed deliveries per instance per minute (bounds Firestore work); max 2 instances (ADR-0028). */
export const WEBHOOK_RATE_LIMIT = 300;
/** How long the repo → project map is reused; a new registration applies within this time. */
export const REPO_INDEX_TTL_MS = 60_000;

export interface WebhookDeps {
  /** The webhook secret, or null before GitHub is connected (deliveries then get 503). */
  secret: () => Promise<string | null>;
  events: CodeEventLog;
  tracker: WorkTracker;
  /** The app's ticket rules, with its run canceller (a merge stops the ticket's runs). */
  tickets: TicketService;
  now?: () => Date;
}

function log(
  severity: "INFO" | "WARNING" | "ERROR",
  message: string,
  fields: Record<string, unknown> = {},
) {
  console.log(JSON.stringify({ severity, message, component: "github-webhook", ...fields }));
}

/** Caches the project list briefly so a burst of deliveries costs one Firestore list. */
export class RepoIndex {
  private projects: Project[] = [];
  private loadedAt = -Infinity;

  constructor(
    private readonly tracker: WorkTracker,
    private readonly now: () => number = Date.now,
  ) {}

  async projectFor(repo: string): Promise<Project | null> {
    if (this.now() - this.loadedAt >= REPO_INDEX_TTL_MS) {
      this.projects = await this.tracker.listProjects();
      this.loadedAt = this.now();
    }
    return projectForRepo(this.projects, repo);
  }
}

export function registerGitHubWebhook(app: Hono<AuthEnv>, deps: WebhookDeps): void {
  const now = deps.now ?? (() => new Date());
  const limiter = new FixedWindowLimiter(WEBHOOK_RATE_LIMIT, 60_000, () => now().getTime());
  const repos = new RepoIndex(deps.tracker, () => now().getTime());
  const prTickets = new PullRequestTickets(deps.tickets, deps.tracker);

  /**
   * The delivery is already recorded, so a failure here is logged, not retried: a redelivery
   * would be a duplicate. Andy moves the ticket by hand from the log line.
   */
  async function moveTicket(record: CodeHostEvent, project: Project) {
    if (record.kind !== "pull_request") return;
    const fields = { deliveryId: record.deliveryId, pr: record.pullRequest.number };
    try {
      const outcome = await prTickets.apply(record, project);
      log("INFO", "webhook ticket update", { ...fields, ...outcome });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log("ERROR", "webhook ticket update failed", { ...fields, error: error.message });
    }
  }

  app.post(
    WEBHOOK_PATH,
    bodyLimit({
      maxSize: MAX_WEBHOOK_BYTES,
      onError: (c) => {
        log("WARNING", "webhook body too large");
        return c.json({ error: "request body too large" }, 413);
      },
    }),
    async (c) => {
      const secret = await deps.secret();
      if (!secret) return c.json({ error: "GitHub is not connected" }, 503);
      const raw = await c.req.text();
      if (!(await verifySignature(secret, raw, c.req.header("x-hub-signature-256")))) {
        log("WARNING", "webhook signature rejected");
        return c.json({ error: "invalid signature" }, 401);
      }
      if (!limiter.tryTake()) {
        log("WARNING", "webhook rate limit hit");
        return c.json({ error: "rate limited" }, 429);
      }

      const event = c.req.header("x-github-event") ?? "";
      const deliveryId = c.req.header("x-github-delivery") ?? "";
      if (!DeliveryId.safeParse(deliveryId).success) {
        return c.json({ error: "missing or invalid delivery id" }, 400);
      }
      if (event === "ping") return c.json({ result: "pong" }, 200);
      if (!isRecordedEvent(event)) {
        log("INFO", "webhook event ignored", { event, deliveryId });
        return c.json({ result: "ignored", reason: "event" }, 202);
      }

      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return c.json({ error: "body is not JSON" }, 400);
      }
      const repo = webhookRepo(payload);
      const project = repo ? await repos.projectFor(repo) : null;
      if (!project) {
        log("INFO", "webhook for an unregistered repo ignored", { event, deliveryId, repo });
        return c.json({ result: "ignored", reason: "repo" }, 202);
      }

      try {
        const record = toCodeHostEvent(
          { event, deliveryId, projectId: project.id, receivedAt: now().toISOString() },
          payload,
        );
        const result = await deps.events.record(record);
        log("INFO", "webhook recorded", {
          event,
          action: record.action,
          deliveryId,
          repo: record.repo,
          projectId: project.id,
          result,
        });
        if (result === "recorded") await moveTicket(record, project);
        return c.json({ result }, 200);
      } catch (err) {
        if (!(err instanceof WebhookPayloadError)) throw err;
        log("WARNING", err.message, { event, deliveryId, repo });
        return c.json({ error: err.message }, 400);
      }
    },
  );
}
