import { Link } from "@tanstack/react-router";
import { QueryError } from "@/components/Status";
import { Button } from "@/components/ui/button";
import { useDigest, useRetryDigestSummary } from "@/lib/queries";

type Refs = { tickets: string[]; prs: number[] };

/**
 * The latest finished day's model-written summary at the top of What's new (AI-323, ADR-0137),
 * each claim's tickets and PRs as links. It shares the 24-hour digest read the Exceptions block
 * makes, so it adds no request; that read is what starts the day's one agent task. Without a
 * summary it says why, and a failed one offers its single retry.
 */
export function DailySummary({ projectId }: { projectId: string }) {
  const digest = useDigest(projectId, 24);
  const retry = useRetryDigestSummary(projectId);
  const summary = digest.data?.summary;
  if (!summary) return null;
  const refs = (r: Refs) => (
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
      {retry.isError && <QueryError error={retry.error} what="the summary retry" />}
    </section>
  );
}
