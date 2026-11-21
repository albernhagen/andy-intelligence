import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  DeliveryId,
  type CodeEventLog,
  type CodeHost,
  type CodeHostEvent,
  type NightLaunchStore,
  type Project,
  type ReleaseNoteStore,
  type RunStore,
  type WorkTracker,
  type ReviewFindingSource,
} from "@andy/contracts";
import {
  EpicMerges,
  PullRequestGate,
  PullRequestTickets,
  ReleaseNoteRecorder,
  projectForRepo,
  type TicketService,
} from "@andy/domain";
import {
  WebhookPayloadError,
  isBranchPush,
  isRecordedEvent,
  toCodeHostEvent,
  verifySignature,
  webhookRepo,
} from "@andy/github";
import type { AuthEnv } from "../auth";
import { FixedWindowLimiter } from "../mcp/rate-limit";
import type { RouteModule } from "../services";
import { ConnectedCodeHost } from "./connection";

/**
 * GitHub App webhook receiver (ADR-0041, ADR-0043: secret read from the connection). Order of checks: body cap → HMAC → rate cap →
 * event type → registered repo → record once by delivery ID → (pull requests, first delivery
 * only) move the linked ticket (AI-14), run the gate, store a release note on merge (AI-159). Nothing is stored before the signature checks out, and
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
  /** For the review gate (AI-34): reads PRs and checks, merges with the App's identity. */
  codeHost: CodeHost;
  runs: RunStore;
  /**
   * The default branch of the project's repo moved (AI-72): queue sync runs for open agent PRs.
   * Called after a default-branch push and after a PR merges into it, on a redelivery too.
   * Resolves false when the tick failed (it logs why). Must not throw.
   */
  onDefaultBranchMoved?: (projectId: string) => Promise<boolean>;
  /** Night launches: a story PR into its launch's epic branch merges there (AI-124). */
  nightLaunches?: NightLaunchStore;
  /** Release notes (AI-159): a PR merged into the default branch stores one. Off when unset. */
  releaseNotes?: ReleaseNoteStore;
  /**
   * Review findings per PR head (ADR-0097), for the merge verdict (AI-215). Unset: the verdict
   * can't see open should-fix findings, so nothing merges into the default branch.
   */
  reviewFindings?: ReviewFindingSource;
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
  const epicMerges = deps.nightLaunches ? new EpicMerges(deps.nightLaunches, deps.runs) : null;
  const gate = new PullRequestGate(
    deps.codeHost,
    deps.tracker,
    deps.runs,
    deps.tickets,
    now,
    null,
    epicMerges,
    deps.reviewFindings ?? null,
  );
  const notes = deps.releaseNotes
    ? new ReleaseNoteRecorder(deps.codeHost, deps.tracker, deps.releaseNotes, now)
    : null;

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

  /** As above: logged, never retried. Any error leaves the PR unmerged, for Andy. */
  async function applyGate(record: CodeHostEvent, project: Project) {
    try {
      const results = await gate.apply(record, project);
      if (results.length) log("INFO", "webhook gate", { deliveryId: record.deliveryId, results });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log("ERROR", "webhook gate failed", { deliveryId: record.deliveryId, error: error.message });
    }
  }

  /** As above: logged, never retried. A missing note shows as a gap on the What's new page. */
  async function recordNote(record: CodeHostEvent, project: Project) {
    if (!notes || record.kind !== "pull_request") return;
    const fields = { deliveryId: record.deliveryId, pr: record.pullRequest.number };
    try {
      const outcome = await notes.record(record, project);
      if (outcome.result !== "recorded") return;
      // A failed read still stored a "no note" row; the warning says why it has no text.
      log(outcome.readError ? "WARNING" : "INFO", "webhook release note", {
        ...fields,
        ...outcome,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log("ERROR", "webhook release note failed", { ...fields, error: error.message });
    }
  }

  /**
   * Main moved: a push to the default branch, or a PR merged into it (the same move, and the only
   * one an App without the push event sees). Runs on redeliveries too: the tick is idempotent,
   * so a failed one (answered 500, logged) can be redelivered from GitHub; any later tick (a run
   * ending) also catches up, because each tick derives the stale PRs from the host again.
   */
  async function syncOnMove(record: CodeHostEvent, project: Project): Promise<boolean> {
    const moved =
      (record.kind === "push" && record.push.defaultBranch) ||
      (record.kind === "pull_request" &&
        record.action === "closed" &&
        record.pullRequest.state === "merged" &&
        record.pullRequest.intoDefaultBranch);
    if (!moved || !deps.onDefaultBranchMoved) return true;
    log("INFO", "default branch moved: syncing open agent PRs", {
      deliveryId: record.deliveryId,
      projectId: project.id,
    });
    return deps.onDefaultBranchMoved(project.id);
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
      // Only branch moves are worth a record: tag pushes and deletions are dropped.
      if (event === "push" && !isBranchPush(payload)) {
        return c.json({ result: "ignored", reason: "ref" }, 202);
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
        // Pushes to other branches (every agent push) aren't stored: only main moving matters.
        if (record.kind === "push" && !record.push.defaultBranch) {
          return c.json({ result: "ignored", reason: "branch" }, 202);
        }
        const result = await deps.events.record(record);
        log("INFO", "webhook recorded", {
          event,
          action: record.action,
          deliveryId,
          repo: record.repo,
          projectId: project.id,
          result,
        });
        if (result === "recorded") {
          await moveTicket(record, project);
          await applyGate(record, project);
          await recordNote(record, project);
        }
        if (!(await syncOnMove(record, project))) {
          return c.json({ error: "sync queueing failed; redeliver to retry" }, 500);
        }
        return c.json({ result }, 200);
      } catch (err) {
        if (!(err instanceof WebhookPayloadError)) throw err;
        log("WARNING", err.message, { event, deliveryId, repo });
        return c.json({ error: err.message }, 400);
      }
    },
  );
}

/** Listed in `public-routes.ts` (AI-145): GitHub signs webhooks (HMAC). Needs the GitHub App. */
export const publicRoutes: RouteModule = (app, s) => {
  const { connection } = s;
  const github = s.deps.github;
  if (!github || !connection) return;
  registerGitHubWebhook(app, {
    secret: async () => (await connection.get())?.webhookSecret ?? null,
    events: github.events,
    tracker: s.tracker,
    tickets: s.service,
    codeHost: new ConnectedCodeHost(connection),
    runs: s.deps.runs,
    onDefaultBranchMoved: (projectId) => s.syncer.defaultBranchMoved(projectId),
    nightLaunches: s.deps.nightLaunches,
    releaseNotes: s.deps.releaseNotes,
    reviewFindings: s.deps.reviewFindings,
    now: s.now,
  });
};
