import {
  CheckConclusion,
  CodeHostEvent,
  type CheckStatus,
  type CodeHostEvent as CodeHostEventType,
} from "@andy/contracts";
import { verify } from "@octokit/webhooks-methods";
import { z } from "zod";

/**
 * GitHub webhook intake (ADR-0041): signature check and payload → CodeHostEvent mapping.
 * Payloads are untrusted until the signature checks out, and only the fields below are kept.
 */

/** Events the control plane records. `ping` (sent when the hook is created) is acknowledged. */
export const RECORDED_EVENTS = ["pull_request", "check_run", "workflow_run"] as const;
export type RecordedEvent = (typeof RECORDED_EVENTS)[number];

export function isRecordedEvent(name: string): name is RecordedEvent {
  return (RECORDED_EVENTS as readonly string[]).includes(name);
}

/** Thrown when a correctly signed payload doesn't have the shape we expect. */
export class WebhookPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookPayloadError";
  }
}

/** HMAC-SHA256 check of `X-Hub-Signature-256` over the raw body (constant-time compare). */
export async function verifySignature(
  secret: string,
  rawBody: string,
  signature: string | undefined,
): Promise<boolean> {
  if (!signature?.startsWith("sha256=")) return false;
  try {
    return await verify(secret, rawBody, signature);
  } catch {
    return false; // malformed signature header
  }
}

const RepositoryPayload = z.object({ repository: z.object({ full_name: z.string() }) });

/** The repo a payload is about, or null if it names none. */
export function webhookRepo(payload: unknown): string | null {
  const parsed = RepositoryPayload.safeParse(payload);
  return parsed.success ? parsed.data.repository.full_name : null;
}

const cap = (s: string, n = 256) => (s.length > n ? s.slice(0, n) : s);

/** Only the description's first line is kept: it may carry the ticket key (AI-14). */
const firstLine = (s: string) => s.split(/\r?\n/, 1)[0]?.trim() ?? "";

const status = (s: string): CheckStatus =>
  s === "completed" ? "completed" : s === "in_progress" ? "in_progress" : "queued";

/** Conclusions we don't know (GitHub adds some over time) become "other". */
const conclusion = (c: string | null | undefined) =>
  c == null ? null : CheckConclusion.catch("other").parse(c);

const PullRequestPayload = z.object({
  action: z.string(),
  repository: z.object({ default_branch: z.string().nullish() }).nullish(),
  pull_request: z.object({
    number: z.number(),
    state: z.string(),
    merged: z.boolean().nullish(),
    draft: z.boolean().nullish(),
    title: z.string(),
    body: z.string().nullish(),
    head: z.object({
      ref: z.string(),
      sha: z.string(),
      // null when the fork was deleted
      repo: z.object({ full_name: z.string() }).nullish(),
    }),
    base: z.object({ ref: z.string() }),
    html_url: z.string(),
  }),
});

const CheckRunPayload = z.object({
  action: z.string(),
  check_run: z.object({
    id: z.number(),
    name: z.string(),
    status: z.string(),
    conclusion: z.string().nullish(),
    head_sha: z.string(),
    html_url: z.string(),
    pull_requests: z.array(z.object({ number: z.number() })).default([]),
  }),
});

const WorkflowRunPayload = z.object({
  action: z.string(),
  workflow_run: z.object({
    id: z.number(),
    name: z.string().nullish(),
    event: z.string(),
    status: z.string().nullish(),
    conclusion: z.string().nullish(),
    head_branch: z.string().nullish(),
    head_sha: z.string(),
    html_url: z.string(),
  }),
});

export interface DeliveryMeta {
  event: RecordedEvent;
  deliveryId: string;
  projectId: string;
  receivedAt: string;
}

/** Maps a verified payload of a recorded event type onto the domain record. */
export function toCodeHostEvent(meta: DeliveryMeta, payload: unknown): CodeHostEventType {
  const repo = webhookRepo(payload);
  if (!repo) throw new WebhookPayloadError("payload has no repository");
  const base = {
    deliveryId: meta.deliveryId,
    projectId: meta.projectId,
    repo,
    receivedAt: meta.receivedAt,
  };
  const result = CodeHostEvent.safeParse(build(meta.event, base, payload));
  if (!result.success) throw new WebhookPayloadError(`unexpected ${meta.event} payload`);
  return result.data;
}

function build(event: RecordedEvent, base: { repo: string }, payload: unknown): unknown {
  switch (event) {
    case "pull_request": {
      const { action, pull_request: pr, repository } = parse(PullRequestPayload, payload, event);
      const { repo } = base;
      const defaultBranch = repository?.default_branch;
      return {
        ...base,
        kind: event,
        action: cap(action, 64),
        pullRequest: {
          number: pr.number,
          state: pr.merged ? "merged" : pr.state === "open" ? "open" : "closed",
          draft: pr.draft ?? false,
          title: cap(pr.title),
          bodyFirstLine: cap(firstLine(pr.body ?? "")),
          fromFork: pr.head.repo?.full_name !== repo,
          intoDefaultBranch: pr.base.ref === defaultBranch,
          headRef: pr.head.ref,
          headSha: pr.head.sha,
          baseRef: pr.base.ref,
          url: pr.html_url,
        },
      };
    }
    case "check_run": {
      const { action, check_run: run } = parse(CheckRunPayload, payload, event);
      return {
        ...base,
        kind: event,
        action: cap(action, 64),
        checkRun: {
          id: String(run.id),
          name: cap(run.name),
          status: status(run.status),
          conclusion: conclusion(run.conclusion),
          headSha: run.head_sha,
          url: run.html_url,
          pullRequestNumbers: run.pull_requests.map((p) => p.number),
        },
      };
    }
    case "workflow_run": {
      const { action, workflow_run: run } = parse(WorkflowRunPayload, payload, event);
      return {
        ...base,
        kind: event,
        action: cap(action, 64),
        workflowRun: {
          id: String(run.id),
          name: cap(run.name ?? ""),
          trigger: run.event,
          status: status(run.status ?? "queued"),
          conclusion: conclusion(run.conclusion),
          headBranch: run.head_branch ?? null,
          headSha: run.head_sha,
          url: run.html_url,
        },
      };
    }
  }
}

function parse<S extends z.ZodType>(schema: S, payload: unknown, event: string): z.infer<S> {
  const result = schema.safeParse(payload);
  if (!result.success) throw new WebhookPayloadError(`unexpected ${event} payload`);
  return result.data;
}
