import {
  REVIEW_VERDICT_LIMITS,
  ReviewVerdictReport,
  type ReviewFindingLog,
  type ReviewerRole,
  type WorkTracker,
} from "@andy/contracts";
import { projectForRepo } from "@andy/domain";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AuthEnv } from "./auth";
import type { ActionsTokenVerifier } from "./github/token";
import { FixedWindowLimiter } from "./mcp/rate-limit";

/**
 * Review findings in (ADR-0097 PR B, ADR-0019 pattern): each PR review verdict's findings,
 * posted by the review workflow's `record-findings` job with its Actions OIDC token. Who is
 * calling comes only from the token: the repo, the PR (`refs/pull/<n>/merge`) and the reviewer
 * (the workflow file). The body carries the head SHA and findings, checked and capped; their
 * text is untrusted data. Stored findings feed the config proposals sweep (ADR-0097).
 */

export const REVIEW_FINDINGS_PATH = "/review/findings";
/** Verdicts accepted per instance per minute (max 2 instances; ADR-0028). */
export const REVIEW_FINDINGS_RATE_LIMIT = 60;
const BODY_MAX_BYTES = 64 * 1024;

const ROLE_SEVERITIES: Record<ReviewerRole, readonly string[]> = {
  security: ["critical", "high", "medium", "low", "info"],
  adversarial: ["blocker", "should-fix", "question"],
};

/** The verdict's caller from a review workflow's `workflow_ref`; null for any other workflow. */
export function reviewCaller(claims: {
  repository: string;
  workflow_ref: string;
}): { repo: string; pullNumber: number; reviewer: ReviewerRole } | null {
  const m =
    /^([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100})\/\.github\/workflows\/(security|adversarial)-review\.yml@refs\/pull\/([1-9][0-9]{0,8})\/merge$/.exec(
      claims.workflow_ref,
    );
  if (!m || m[1] !== claims.repository) return null;
  return { repo: m[1], reviewer: m[2] as ReviewerRole, pullNumber: Number(m[3]) };
}

export interface ReviewFindingsDeps {
  log: ReviewFindingLog;
  tracker: Pick<WorkTracker, "listProjects">;
  verify: ActionsTokenVerifier;
  now?: () => Date;
}

function log(severity: "INFO" | "WARNING", message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ severity, message, component: "review-findings", ...fields }));
}

export function registerReviewFindings(app: Hono<AuthEnv>, deps: ReviewFindingsDeps): void {
  const now = deps.now ?? (() => new Date());
  const limiter = new FixedWindowLimiter(REVIEW_FINDINGS_RATE_LIMIT, 60_000, () => now().getTime());

  app.post(
    REVIEW_FINDINGS_PATH,
    bodyLimit({
      maxSize: BODY_MAX_BYTES,
      onError: (c) => c.json({ error: "request body too large" }, 413),
    }),
    async (c) => {
      const match = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
      let claims;
      try {
        if (!match?.[1]) throw new Error("no bearer token");
        claims = await deps.verify(match[1]);
      } catch {
        log("WARNING", "actions token rejected");
        return c.json({ error: "unauthenticated" }, 401);
      }
      const caller = reviewCaller(claims);
      if (!caller) {
        log("WARNING", "not a review workflow", { ...claims });
        return c.json({ error: "forbidden" }, 403);
      }
      // After verification, so unauthenticated floods can't use up the cap.
      if (!limiter.tryTake()) return c.json({ error: "rate limited" }, 429);
      const project = projectForRepo(await deps.tracker.listProjects(), caller.repo);
      if (!project) {
        log("WARNING", "review findings from a repo in no project", { repo: caller.repo });
        return c.json({ error: "forbidden" }, 403);
      }
      const body = ReviewVerdictReport.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: "invalid verdict" }, 400);
      const allowed = ROLE_SEVERITIES[caller.reviewer];
      if (body.data.findings.some((f) => !allowed.includes(f.severity))) {
        return c.json({ error: `a severity the ${caller.reviewer} review doesn't use` }, 400);
      }
      const recordedAt = now().toISOString();
      const identity = {
        projectId: project.id,
        repo: caller.repo,
        pullNumber: caller.pullNumber,
        reviewer: caller.reviewer,
        headSha: body.data.headSha,
        recordedAt,
      };
      await deps.log.recordVerdict(
        { ...identity, findings: body.data.findings.map((f) => ({ ...identity, ...f })) },
        REVIEW_VERDICT_LIMITS.perProject,
      );
      log("INFO", "review verdict recorded", {
        ...identity,
        findings: body.data.findings.length,
      });
      return c.json({ recorded: body.data.findings.length }, 201);
    },
  );
}
