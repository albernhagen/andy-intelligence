import { useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import type { Digest, DigestSummaryView } from "@andy/contracts";
import { MERGED_BY, gateText } from "@andy/domain";
import { Loading, QueryError } from "@/components/Status";
import { Button } from "@/components/ui/button";
import { useDigest, useRetryDigestSummary } from "@/lib/queries";

const WINDOWS = [
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
];

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * The daily digest (AI-70, ADR-0081) under `/p/<project>/digest`: the latest finished day's
 * model-written summary (AI-323, ADR-0137), then exceptions, then what merged and what it cost,
 * then what is in progress, then totals. The MCP `digest` tool returns the same structure.
 */
export function DigestPage() {
  const { projectId = "" } = useParams({ strict: false });
  const [hours, setHours] = useState(24);
  const digest = useDigest(projectId, hours);

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium">Digest</h2>
        <div role="group" aria-label="Window" className="flex gap-1">
          {WINDOWS.map((w) => (
            <Button
              key={w.hours}
              size="sm"
              variant={w.hours === hours ? "default" : "ghost"}
              aria-pressed={w.hours === hours}
              onClick={() => setHours(w.hours)}
            >
              {w.label}
            </Button>
          ))}
        </div>
        <Link
          to="/p/$projectId/whats-new"
          params={{ projectId }}
          className="ml-auto text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          What's new
        </Link>
      </header>
      {digest.isPending ? (
        <Loading />
      ) : digest.isError ? (
        <QueryError error={digest.error} />
      ) : (
        <>
          {digest.data.summary && (
            <SummaryCard summary={digest.data.summary} projectId={projectId} />
          )}
          <DigestBody digest={digest.data} projectId={projectId} />
        </>
      )}
    </section>
  );
}

function DigestBody({ digest, projectId }: { digest: Digest; projectId: string }) {
  if (digest.quiet) return <p className="text-muted-foreground">{digest.text}</p>;
  const ticket = (key: string | null, title: string | null) =>
    key ? <TicketLink projectId={projectId} ticketKey={key} title={title ?? ""} /> : "Project";
  const { inFlight, readyForReview } = digest.inProgress;
  const t = digest.totals;

  return (
    <>
      <Section title="Exceptions" count={digest.exceptions.length}>
        {digest.exceptions.map((e, i) => (
          <li key={i}>
            {ticket(e.ticketKey, e.title)} · <span className="text-destructive">{e.reason}</span>
          </li>
        ))}
      </Section>
      <Section title="Merged" count={digest.merged.length}>
        {digest.merged.map((m) => (
          <li key={m.prNumber}>
            {ticket(m.ticketKey, m.title)} ·{" "}
            <a href={m.prUrl} className="underline-offset-2 hover:underline">
              PR #{m.prNumber}
            </a>{" "}
            · {MERGED_BY[m.mergedBy]} · {gateText(m)} ·{" "}
            <span className="tabular-nums">{usd(m.costUsd)}</span>
          </li>
        ))}
      </Section>
      <Section title="In progress" count={inFlight.length + readyForReview.length}>
        {inFlight.map((r, i) => (
          <li key={`run-${i}`}>
            In flight: {ticket(r.ticketKey, r.title)} · {r.label}
          </li>
        ))}
        {readyForReview.map((r) => (
          <li key={r.ticketKey}>
            Ready for review: {ticket(r.ticketKey, r.title)}
            {r.prNumber ? ` · PR #${r.prNumber}` : ""}
          </li>
        ))}
      </Section>
      <section aria-label="Totals" className="space-y-1">
        <h3 className="text-sm font-medium">Totals</h3>
        <p className="text-sm tabular-nums">
          {t.runs} runs{t.failedRuns ? ` (${t.failedRuns} failed)` : ""} · {usd(t.costUsd)}{" "}
          estimated{t.unknownCostRuns ? ` (${t.unknownCostRuns} unknown)` : ""} · {t.merged} merged
        </p>
      </section>
      {digest.truncated && (
        <p className="text-sm text-muted-foreground">
          A read cap was reached: some tickets or runs may be missing.
        </p>
      )}
    </>
  );
}

/**
 * The day's summary, labelled as model-written, each line's tickets and PRs as links. Without
 * one, it says why; a failed one offers its single retry. The plain list always follows.
 */
function SummaryCard({ summary, projectId }: { summary: DigestSummaryView; projectId: string }) {
  const retry = useRetryDigestSummary(projectId);
  const refs = (r: { tickets: string[]; prs: number[] }) => (
    <span className="text-xs text-muted-foreground">
      {r.tickets.map((key) => (
        <Link
          key={key}
          to="/p/$projectId/t/$ticketRef"
          params={{ projectId, ticketRef: key }}
          className="mr-1 underline-offset-2 hover:underline"
        >
          {key}
        </Link>
      ))}
      {r.prs.map((n) => (
        <span key={n} className="mr-1 tabular-nums">
          #{n}
        </span>
      ))}
    </span>
  );
  const label = `Model-written summary of ${summary.day}${summary.model ? ` (${summary.model})` : ""}`;
  return (
    <section aria-label="Summary" className="space-y-2 rounded-md border p-3">
      <h3 className="text-sm font-medium">{label}</h3>
      {summary.state === "ready" && summary.output ? (
        <>
          <p className="text-sm">
            {summary.output.summary} {refs(summary.output.summaryRefs)}
          </p>
          {summary.output.lines.length > 0 && (
            <ul className="space-y-1 text-sm">
              {summary.output.lines.map((l, i) => (
                <li key={i}>
                  <span className="font-medium">{l.heading}:</span> {l.text} {refs(l.refs)}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : summary.state === "writing" ? (
        <p className="text-sm text-muted-foreground">Being written by an agent task.</p>
      ) : (
        <p className="text-sm text-muted-foreground">No summary: {summary.reason}.</p>
      )}
      {summary.canRetry && (
        <Button
          size="sm"
          variant="outline"
          disabled={retry.isPending}
          onClick={() => retry.mutate()}
        >
          Retry once
        </Button>
      )}
      {retry.isError && <QueryError error={retry.error} />}
    </section>
  );
}

function Section(props: { title: string; count: number; children: ReactNode }) {
  if (props.count === 0) return null;
  return (
    <section aria-label={props.title} className="space-y-1">
      <h3 className="text-sm font-medium">
        {props.title} <span className="text-muted-foreground tabular-nums">{props.count}</span>
      </h3>
      <ul className="space-y-1 text-sm">{props.children}</ul>
    </section>
  );
}

function TicketLink(props: { projectId: string; ticketKey: string; title: string }) {
  return (
    <Link
      to="/p/$projectId/t/$ticketRef"
      params={{ projectId: props.projectId, ticketRef: props.ticketKey }}
      className="underline-offset-2 hover:underline"
    >
      <span className="text-xs text-muted-foreground tabular-nums">{props.ticketKey}:</span>{" "}
      {props.title}
    </Link>
  );
}
