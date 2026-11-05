import { useState } from "react";
import type { Run, RunStatus } from "@andy/contracts";
import { QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isActiveRun, useStartRun } from "@/lib/queries";

type TicketPath = { projectId: string; ticketId: string };

/** Summaries longer than this start collapsed behind "Show report". */
const SHORT_SUMMARY_CHARS = 400;
const SHORT_SUMMARY_LINES = 6;

/** Status markers from design.md. */
const STATUS_VARIANT: Record<RunStatus, "default" | "running" | "success" | "danger"> = {
  queued: "default",
  running: "running",
  succeeded: "success",
  failed: "danger",
  cancelled: "default",
};

/**
 * Starts a refine run on the ticket (M1.6a: Claude Code executor); off while one is in flight.
 * The runs themselves show in the activity timeline (`RunItem`); `useRuns` polls while one is in
 * flight and refetches everything when it ends, so a refine run's questions appear (M1.7).
 */
export function StartRefineRun({ path, runs }: { path: TicketPath; runs: Run[] | undefined }) {
  const start = useStartRun(path);
  const inFlight = runs?.some(isActiveRun) ?? false;
  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={start.isPending || inFlight}
        onClick={() => start.mutate({ step: "refine" })}
      >
        Start refine run
      </Button>
      {start.error && <QueryError error={start.error} />}
    </div>
  );
}

/** One run in the timeline. Agent text (summary, error) is untrusted: plain text only. */
export function RunItem({ run }: { run: Run }) {
  const created = run.createdAt ?? run.startedAt;
  return (
    <li className="space-y-1 rounded-md border border-border p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[run.status]}>{run.status}</Badge>
        <span className="font-medium">{run.step}</span>
        <span className="text-muted-foreground">{run.route.model}</span>
        {run.retryOf && <span className="text-muted-foreground">retry {run.attempt}</span>}
        {created && <Time label="started" iso={created} />}
        {run.endedAt && <Time label="ended" iso={run.endedAt} />}
        {run.links.executorRun && (
          <a
            href={run.links.executorRun}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto underline"
          >
            Run log
          </a>
        )}
      </p>
      {(run.tokensIn !== null || run.tokensOut !== null || run.costUsd !== null) && (
        <p className="text-muted-foreground">
          {formatTokens(run)} · {formatCost(run)}
        </p>
      )}
      {run.error && <p className="whitespace-pre-wrap text-destructive">{run.error}</p>}
      {run.summary && <Summary text={run.summary} />}
    </li>
  );
}

function Time({ label, iso }: { label: string; iso: string }) {
  return (
    <span className="text-muted-foreground">
      {label} <time dateTime={iso}>{new Date(iso).toLocaleString()}</time>
    </span>
  );
}

/** Plain text only: the summary is untrusted agent output (never parsed as HTML). */
function Summary({ text }: { text: string }) {
  const short =
    text.length <= SHORT_SUMMARY_CHARS && text.split("\n").length <= SHORT_SUMMARY_LINES;
  const [open, setOpen] = useState(short);
  return (
    <div className="space-y-1">
      {!short && (
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
          {open ? "Hide report" : "Show report"}
        </Button>
      )}
      {open && <p className="whitespace-pre-wrap">{text}</p>}
    </div>
  );
}

export function formatTokens(run: Pick<Run, "tokensIn" | "tokensOut">): string {
  const n = (v: number | null) => (v === null ? "—" : v.toLocaleString());
  return `${n(run.tokensIn)} in / ${n(run.tokensOut)} out tokens`;
}

export function formatCost(run: Pick<Run, "costUsd" | "costIsEstimate">): string {
  if (run.costUsd === null) return "cost —";
  const usd = `$${run.costUsd.toFixed(2)}`;
  return run.costIsEstimate ? `~${usd} (estimate)` : usd;
}
