import { Children, isValidElement, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import type { BuildCheck, Run, RunOutcome, RunStep } from "@andy/contracts";
import { Loading, QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STATUS_VARIANT, Summary, formatCost, httpsHref } from "@/components/Runs";
import { formatQuotaDelta } from "@/components/TicketCostLine";
import { ApiError, unwrap, useApi } from "@/lib/api";
import { useLivePoll } from "@/lib/live";
import { isActiveRun, useTicketByRef } from "@/lib/queries";
import { count, dateTime, elapsed } from "@/lib/format";

/** One agent task, polled while it is in flight. A 404 is final: no retries. */
function useRun(projectId: string, runId: string) {
  const api = useApi();
  return useQuery({
    ...useLivePoll("live", isActiveRun),
    queryKey: ["run", projectId, runId],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/runs/{runId}", {
          params: { path: { projectId, runId } },
        }),
      ),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 3,
  });
}

/**
 * The agent task detail screen (AI-101) at `/p/<project>/runs/<runId>`: what ran, what it cost,
 * how it ended and where its log, PR and ticket are. Project-scoped only: a task's URL names its
 * project, and another project's task reads as not found. Agent text is untrusted: plain text.
 */
export function RunPage() {
  const { projectId, runId } = useParams({ from: "/p/$projectId/runs/$runId" });
  const run = useRun(projectId, runId);

  if (run.isPending) return <Loading />;
  if (run.isError) {
    return run.error instanceof ApiError && run.error.status === 404 ? (
      <p className="text-muted-foreground">Agent task not found.</p>
    ) : (
      <QueryError error={run.error} />
    );
  }
  return <RunDetail run={run.data} />;
}

function RunDetail({ run }: { run: Run }) {
  const started = run.startedAt ?? run.createdAt;
  const wall = wallMs(run);
  const quota = run.quotaDelta && formatQuotaDelta(run.quotaDelta);
  const tokensIn = run.tokensIn ?? run.usage?.inputTokens ?? null;
  const tokensOut = run.tokensOut ?? run.usage?.outputTokens ?? null;
  return (
    <article className="max-w-2xl space-y-4 wrap-anywhere" aria-label="Agent task">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium">Agent task · {run.step}</h2>
        <Badge variant={STATUS_VARIANT[run.status]}>{run.status}</Badge>
      </header>

      {/* AI-340: one sentence saying what it did or is doing, then the PR and log. */}
      {run.ticketId ? (
        <TicketSummary run={run} ticketId={run.ticketId} />
      ) : (
        <WhatHappened run={run} ticketKey={null} />
      )}
      <Links run={run} />

      <Facts title="Details">
        <Fact label="Model">{run.route.model}</Fact>
        <Fact label="Harness">{run.route.harness}</Fact>
        <Fact label="Provider">{run.route.provider}</Fact>
        <Fact label="Tier">{run.tier}</Fact>
        {(run.attempt > 1 || run.retryOf) && (
          <Fact label="Attempt">
            {run.attempt}
            {run.retryOf && (
              <>
                {" · "}
                <Link
                  to="/p/$projectId/runs/$runId"
                  params={{ projectId: run.projectId, runId: run.retryOf }}
                  className="underline"
                >
                  Retry of the earlier agent task
                </Link>
              </>
            )}
          </Fact>
        )}
        <Fact label="Started">{started && <Time iso={started} />}</Fact>
        <Fact label="Ended">{run.endedAt && <Time iso={run.endedAt} />}</Fact>
        <Fact label="Wall time">{wall !== null && elapsed(wall)}</Fact>
        <Fact label="Outcome">{run.outcome && OUTCOME_TEXT[run.outcome]}</Fact>
        <Fact label="Gate">{gateText(run)}</Fact>
      </Facts>

      <Facts title="Usage and cost">
        <Fact label="Tokens in">{countOf(tokensIn)}</Fact>
        <Fact label="Tokens out">{countOf(tokensOut)}</Fact>
        <Fact label="Cache read">{countOf(run.usage?.cacheReadTokens)}</Fact>
        <Fact label="Cache write">{countOf(run.usage?.cacheWriteTokens)}</Fact>
        <Fact label="Turns">{countOf(run.usage?.turns)}</Fact>
        {/* No usage reported means unknown, never $0 (ADR-0046); said once the task ends. */}
        <Fact label="Cost">
          {run.costUsd !== null ? formatCost(run) : !isActiveRun(run) && "unknown"}
        </Fact>
        <Fact label="Quota used">{quota}</Fact>
      </Facts>

      {/* The summary already says the first line; the full error shows only when it says more. */}
      {run.error && run.error.trim().includes("\n") && (
        <p className="whitespace-pre-wrap text-sm text-destructive">{run.error}</p>
      )}
      {run.summary && (
        <Section title="Report">
          <Summary text={run.summary} />
        </Section>
      )}
      {run.plan && <Plan plan={run.plan} />}
      {run.verification.length > 0 && <Verification checks={run.verification} />}
    </article>
  );
}

function WhatHappened({ run, ticketKey }: { run: Run; ticketKey: string | null }) {
  return (
    <p aria-label="What happened" className="text-sm">
      {runSummary(run, ticketKey, new Date())}
    </p>
  );
}

/** The summary names the ticket by key once it loads (the same query the ticket link uses). */
function TicketSummary({ run, ticketId }: { run: Run; ticketId: string }) {
  const key = useTicketByRef(run.projectId, ticketId).data?.key ?? null;
  return <WhatHappened run={run} ticketKey={key} />;
}

/** The PR and the log as buttons (one click from the top); the ticket and branch beside them. */
function Links({ run }: { run: Run }) {
  const pr = httpsHref(run.links.pullRequest);
  const log = httpsHref(run.links.executorRun);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {pr && (
        <Button asChild size="sm" variant="outline" className="h-11 sm:h-8">
          <a href={pr} target="_blank" rel="noopener noreferrer">
            {prLabel(pr)}
            <ExternalLink aria-hidden className="size-3.5" />
          </a>
        </Button>
      )}
      {log && (
        <Button asChild size="sm" variant="outline" className="h-11 sm:h-8">
          <a href={log} target="_blank" rel="noopener noreferrer">
            Task log
            <ExternalLink aria-hidden className="size-3.5" />
          </a>
        </Button>
      )}
      {run.ticketId && <TicketLink projectId={run.projectId} ticketId={run.ticketId} />}
      {run.branch && <span className="text-muted-foreground">branch {run.branch}</span>}
    </div>
  );
}

/** "AI-7: Title" once the ticket loads; the link works before that too. */
function TicketLink({ projectId, ticketId }: { projectId: string; ticketId: string }) {
  const ticket = useTicketByRef(projectId, ticketId).data;
  return (
    <Link
      to="/p/$projectId/t/$ticketRef"
      params={{ projectId, ticketRef: ticket?.key ?? ticketId }}
      className="underline"
    >
      {ticket ? `${ticket.key}: ${ticket.title}` : "Ticket"}
    </Link>
  );
}

function Plan({ plan }: { plan: NonNullable<Run["plan"]> }) {
  return (
    <Section title="Plan">
      <ol className="list-decimal space-y-1 pl-5">
        {plan.steps.map((step, i) => (
          <li key={i} className="whitespace-pre-wrap">
            {step}
          </li>
        ))}
      </ol>
      {plan.files.length > 0 && (
        <p className="text-muted-foreground">Files: {plan.files.join(", ")}</p>
      )}
      <p className="text-muted-foreground">Riskiest step: {plan.riskiestStep}</p>
    </Section>
  );
}

function Verification({ checks }: { checks: BuildCheck[] }) {
  return (
    <Section title="Verification">
      <ul className="space-y-1">
        {checks.map((check, i) => (
          <li key={i}>
            <details>
              <summary className="cursor-pointer">
                <Badge variant={check.passed ? "success" : "danger"}>
                  {check.passed ? "passed" : "failed"}
                </Badge>{" "}
                <code>{check.command}</code>
              </summary>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
                {check.output || "No output."}
              </pre>
            </details>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-1 text-sm">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

/** A two-column list of facts; with no fact that has a value, the whole section is left out. */
function Facts({ title, children }: { title: string; children: ReactNode }) {
  const shown = Children.toArray(children).filter(
    (c) => isValidElement<{ children?: ReactNode }>(c) && hasValue(c.props.children),
  );
  if (shown.length === 0) return null;
  return (
    <Section title={title}>
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1 sm:grid-cols-[8rem_1fr]">
        {shown}
      </dl>
    </Section>
  );
}

/** A label and its value; a row with no value doesn't show (AI-340). */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  if (!hasValue(children)) return null;
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </>
  );
}

const countOf = (n: number | null | undefined) => (n == null ? null : count(n));

const hasValue = (v: ReactNode) => v !== null && v !== undefined && v !== false && v !== "";

function Time({ iso }: { iso: string }) {
  return <time dateTime={iso}>{dateTime(iso)}</time>;
}

/** The harness's own wall time, else ended minus started; null while either is missing. */
export function wallMs(run: Pick<Run, "usage" | "startedAt" | "endedAt">): number | null {
  if (run.usage?.wallMs != null) return run.usage.wallMs;
  if (!run.startedAt || !run.endedAt) return null;
  return Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt));
}

/** The gate's verdict on a build's PR in words; null when the gate hasn't looked at it. */
export function gateText(run: Pick<Run, "wouldAutoMerge" | "gateReasons">): string | null {
  if (run.wouldAutoMerge === null) return null;
  if (run.wouldAutoMerge) return "would merge on its own";
  return run.gateReasons.length
    ? `waits for you: ${run.gateReasons.map(words).join(", ")}`
    : "waits for you";
}

const words = (code: string) => code.replaceAll("_", " ");

const OUTCOME_TEXT: Record<RunOutcome, string> = {
  merged_clean: "merged with no rework",
  reworked: "merged after rework",
  reverted: "reverted",
  failed: "failed",
};

/** "Building", "Built"… for the summary line, by step and whether it is still going. */
const STEP_VERBS: Record<RunStep, [going: string, done: string]> = {
  refine: ["Refining", "Refined"],
  plan: ["Planning", "Planned"],
  build: ["Building", "Built"],
  review: ["Reviewing", "Reviewed"],
  verify: ["Verifying", "Verified"],
  scout: ["Scouting", "Scouted"],
  sync: ["Syncing", "Synced"],
  "plan-project": ["Planning the project", "Planned the project"],
  ideate: ["Ideating", "Ideated"],
};

/** "PR #72", or "Pull request" for a URL without a number. */
export function prLabel(url: string): string {
  const n = /\/pull\/(\d+)/.exec(url)?.[1];
  return n ? `PR #${n}` : "Pull request";
}

/**
 * One sentence on what the agent task did or is doing (AI-340), from fields the API already
 * returns: "Refining AI-3 for 12 min on sonnet", "Built AI-7 in 10 min: PR #72, waits for you:
 * protected path", "Failed after 3 min: <first line of the error>".
 */
export function runSummary(
  run: Pick<
    Run,
    | "step"
    | "status"
    | "route"
    | "createdAt"
    | "startedAt"
    | "endedAt"
    | "usage"
    | "links"
    | "error"
    | "wouldAutoMerge"
    | "gateReasons"
  >,
  ticketKey: string | null,
  now: Date,
): string {
  const [going, done] = STEP_VERBS[run.step];
  // A sentence reads in whole minutes once past one ("10 min", not "10 min 10 s").
  const about = (ms: number) => elapsed(ms < 60_000 ? ms : Math.round(ms / 60_000) * 60_000);
  const what = ticketKey ? ` ${ticketKey}` : "";
  const on = ` on ${run.route.model}`;
  const wall = wallMs(run);
  switch (run.status) {
    case "queued":
      return `Waiting to start: ${going.toLowerCase()}${what}${on}.`;
    case "running": {
      const since = run.startedAt ?? run.createdAt;
      if (!since) return `${going}${what}${on}.`;
      return `${going}${what} for ${about(now.getTime() - Date.parse(since))}${on}.`;
    }
    case "succeeded": {
      const took = wall === null ? "" : ` in ${about(wall)}`;
      const pr = run.links.pullRequest ? prLabel(run.links.pullRequest) : null;
      const gate = gateText(run);
      const tail = [pr, gate].filter(Boolean).join(", ");
      return `${done}${what}${took}${tail ? `: ${tail}` : ""}.`;
    }
    case "failed": {
      const after = wall === null ? "" : ` after ${about(wall)}`;
      const reason = run.error?.split("\n")[0]?.trim();
      if (!reason) return `Failed${after}: ${going.toLowerCase()}${what}.`;
      return `Failed${after}: ${reason}${reason.endsWith(".") ? "" : "."}`;
    }
    case "cancelled":
      return `Cancelled: ${going.toLowerCase()}${what}.`;
  }
}
