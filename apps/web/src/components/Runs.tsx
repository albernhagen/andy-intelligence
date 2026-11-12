import { useState } from "react";
import type { Run, RunStatus } from "@andy/contracts";
import { QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatQuotaDelta } from "@/components/TicketCostLine";
import { isActiveRun, useDecidePlan, useStartRun } from "@/lib/queries";

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
 * Starts a refine or build run on the ticket (M1.6a: Claude Code executor; M1.8a: Build run);
 * off while one is in flight. The runs themselves show in the activity timeline (`RunItem`,
 * with a build's branch and PR); `useRuns` polls while one is in flight and refetches
 * everything when it ends, so a refine run's questions appear (M1.7: Refinement).
 */
export function StartRuns({ path, runs }: { path: TicketPath; runs: Run[] | undefined }) {
  const start = useStartRun(path);
  const inFlight = runs?.some(isActiveRun) ?? false;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        {(["refine", "build"] as const).map((step) => (
          <Button
            key={step}
            size="sm"
            variant="outline"
            disabled={start.isPending || inFlight}
            onClick={() => start.mutate({ step })}
          >
            Start {step} task
          </Button>
        ))}
      </div>
      {start.error && <QueryError error={start.error} />}
    </div>
  );
}

/** The ticket's latest plan run: the only one Andy can decide (ADR-0050). */
export function latestPlanId(runs: readonly Run[]): string | undefined {
  return runs.find((r) => r.step === "plan")?.id;
}

/**
 * One run in the timeline. Agent text (summary, error) is untrusted: plain text only. The latest
 * plan run, while it awaits Andy, has Approve and Reject buttons (M1.8a: Plan approval).
 */
export function RunItem({
  run,
  path,
  decidable = false,
}: {
  run: Run;
  path?: TicketPath;
  decidable?: boolean;
}) {
  const created = run.createdAt ?? run.startedAt;
  return (
    <li className="space-y-1 rounded-md border border-border p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[run.status]}>{run.status}</Badge>
        <span className="font-medium">Agent task · {run.step}</span>
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
            Task log
          </a>
        )}
      </p>
      {(run.tokensIn !== null || run.tokensOut !== null || run.costUsd !== null) && (
        <p className="text-muted-foreground">
          {formatTokens(run)}
          {run.costUsd !== null && ` · ${formatCost(run)}`}
        </p>
      )}
      {formatUsage(run) && <p className="text-muted-foreground">{formatUsage(run)}</p>}
      {!isActiveRun(run) && run.costUsd === null && (
        <p className="text-muted-foreground">Cost unknown</p>
      )}
      {(run.links.pullRequest || run.branch) && (
        <p className="text-muted-foreground">
          {run.links.pullRequest && (
            <a
              href={run.links.pullRequest}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Pull request
            </a>
          )}
          {run.links.pullRequest && run.branch && " · "}
          {run.branch && <span>branch {run.branch}</span>}
        </p>
      )}
      {run.error && <p className="whitespace-pre-wrap text-destructive">{run.error}</p>}
      {run.summary && <Summary text={run.summary} />}
      {run.planDecision && (
        <p className="text-muted-foreground">
          Plan {run.planDecision.decision} by {run.planDecision.by}
          {run.planDecision.reason && `: ${run.planDecision.reason}`}{" "}
          <Time label="at" iso={run.planDecision.at} />
        </p>
      )}
      {path && decidable && run.status === "succeeded" && run.plan && !run.planDecision && (
        <PlanDecision runId={run.id} path={path} />
      )}
    </li>
  );
}

/** Approve, or reject with a reason (required: the next plan run sees it). */
function PlanDecision({ runId, path }: { runId: string; path: TicketPath }) {
  const decide = useDecidePlan(path);
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={decide.isPending}
        onClick={() => decide.mutate({ runId, decision: "approved" })}
      >
        Approve plan
      </Button>
      <input
        aria-label="Reason to reject"
        placeholder="Reason to reject"
        className="min-w-48 flex-1 rounded border border-border bg-background px-2 py-1"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={decide.isPending || reason.trim() === ""}
        onClick={() => decide.mutate({ runId, decision: "rejected", reason })}
      >
        Reject plan
      </Button>
      {decide.error && <QueryError error={decide.error} />}
    </div>
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

/** Cache, turns, wall time and quota used; empty for a run without them. */
export function formatUsage(run: Pick<Run, "usage" | "quotaDelta">): string {
  const u = run.usage;
  const quota = run.quotaDelta && formatQuotaDelta(run.quotaDelta);
  return [
    u && `${u.cacheReadTokens.toLocaleString()} cache read`,
    u && `${u.cacheWriteTokens.toLocaleString()} cache write`,
    u && u.turns !== null && `${u.turns} turns`,
    u && u.wallMs !== null && `${Math.round(u.wallMs / 1000)}s`,
    quota && `quota ${quota}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatCost(run: Pick<Run, "costUsd" | "costIsEstimate">): string {
  if (run.costUsd === null) return "cost —";
  const usd = `$${run.costUsd.toFixed(2)}`;
  return run.costIsEstimate ? `~${usd} (estimate)` : usd;
}
