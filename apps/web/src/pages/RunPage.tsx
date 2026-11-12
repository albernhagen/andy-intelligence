import type { ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { BuildCheck, Run } from "@andy/contracts";
import { Loading, QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { STATUS_VARIANT, Summary, formatCost, httpsHref } from "@/components/Runs";
import { formatQuotaDelta } from "@/components/TicketCostLine";
import { ApiError, unwrap, useApi } from "@/lib/api";
import { useLivePoll } from "@/lib/live";
import { isActiveRun, useTicketByRef } from "@/lib/queries";

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
  return (
    <article className="max-w-2xl space-y-4" aria-label="Agent task">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium">Agent task · {run.step}</h2>
        <Badge variant={STATUS_VARIANT[run.status]}>{run.status}</Badge>
      </header>

      <Links run={run} />

      <Facts title="Details">
        <Fact label="Harness">{run.route.harness}</Fact>
        <Fact label="Provider">{run.route.provider}</Fact>
        <Fact label="Model">{run.route.model}</Fact>
        <Fact label="Tier">{run.tier ?? "—"}</Fact>
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
        <Fact label="Started">{started ? <Time iso={started} /> : "—"}</Fact>
        <Fact label="Ended">{run.endedAt ? <Time iso={run.endedAt} /> : "—"}</Fact>
        <Fact label="Wall time">{wall === null ? "—" : formatDuration(wall)}</Fact>
      </Facts>

      <Facts title="Usage and cost">
        <Fact label="Tokens in">{count(run.tokensIn ?? run.usage?.inputTokens ?? null)}</Fact>
        <Fact label="Tokens out">{count(run.tokensOut ?? run.usage?.outputTokens ?? null)}</Fact>
        <Fact label="Cache read">{count(run.usage?.cacheReadTokens ?? null)}</Fact>
        <Fact label="Cache write">{count(run.usage?.cacheWriteTokens ?? null)}</Fact>
        <Fact label="Turns">{count(run.usage?.turns ?? null)}</Fact>
        {/* No usage reported means unknown, never $0 (ADR-0046). */}
        <Fact label="Cost">{run.costUsd === null ? "unknown" : formatCost(run)}</Fact>
        <Fact label="Quota used">{quota ?? "unknown"}</Fact>
      </Facts>

      <Facts title="Outcome">
        <Fact label="Outcome">{run.outcome ?? "—"}</Fact>
        <Fact label="Gate">{gateText(run)}</Fact>
      </Facts>

      {run.error && <p className="whitespace-pre-wrap text-sm text-destructive">{run.error}</p>}
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

function Links({ run }: { run: Run }) {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {run.ticketId && <TicketLink projectId={run.projectId} ticketId={run.ticketId} />}
      <External href={run.links.executorRun}>Task log</External>
      <External href={run.links.pullRequest}>Pull request</External>
      {run.branch && <span className="text-muted-foreground">branch {run.branch}</span>}
    </p>
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

function Facts({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section title={title}>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">{children}</dl>
    </Section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </>
  );
}

/** Nothing for a missing or non-https URL. */
function External({ href, children }: { href: string | undefined; children: ReactNode }) {
  const safe = httpsHref(href);
  if (!safe) return null;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className="underline">
      {children}
    </a>
  );
}

function Time({ iso }: { iso: string }) {
  return <time dateTime={iso}>{new Date(iso).toLocaleString()}</time>;
}

const count = (n: number | null) => (n === null ? "—" : n.toLocaleString());

/** The harness's own wall time, else ended minus started; null while either is missing. */
export function wallMs(run: Pick<Run, "usage" | "startedAt" | "endedAt">): number | null {
  if (run.usage?.wallMs != null) return run.usage.wallMs;
  if (!run.startedAt || !run.endedAt) return null;
  return Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt));
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 === 0 ? `${m} min` : `${m} min ${s % 60} s`;
}

/** The gate's verdict on a build's PR: passed, held with its reasons, or not run. */
export function gateText(run: Pick<Run, "wouldAutoMerge" | "gateReasons">): string {
  if (run.wouldAutoMerge === null) return "not run";
  if (run.wouldAutoMerge) return "would auto-merge";
  return run.gateReasons.length ? `held: ${run.gateReasons.join(", ")}` : "held";
}
