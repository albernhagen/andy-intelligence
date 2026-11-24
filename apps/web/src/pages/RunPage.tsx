import { Children, isValidElement, useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ChevronRight, ExternalLink } from "lucide-react";
import type {
  BuildCheck,
  Question,
  Run,
  RunOutcome,
  RunStep,
  Ticket,
  TicketEvent,
} from "@andy/contracts";
import { Loading, QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STATUS_VARIANT, Summary, formatCost, httpsHref } from "@/components/Runs";
import { formatQuotaDelta } from "@/components/TicketCostLine";
import { ApiError } from "@/lib/api";
import { count, dateTime, elapsed, timeOfDay } from "@/lib/format";
import { isActiveRun, useEvents, useRun, useTicketByRef, useTicketQuestions } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * The agent task detail screen (AI-101; AI-377: direction A) at `/p/<project>/runs/<runId>`: one
 * sentence on what it is doing or how it ended, a timeline of its steps with their times, and its
 * model, quota, cost and PR beside them. It updates without a reload while the task runs. Project-scoped only: a task's URL names its
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
      <QueryError error={run.error} what="the agent task" onRetry={() => void run.refetch()} />
    );
  }
  return run.data.ticketId ? (
    <TicketRun run={run.data} ticketId={run.data.ticketId} />
  ) : (
    <RunDetail run={run.data} ticket={undefined} questions={[]} events={[]} />
  );
}

/** A ticket's task also reads the ticket's name, open questions and events (one poll each). */
function TicketRun({ run, ticketId }: { run: Run; ticketId: string }) {
  const path = { projectId: run.projectId, ticketId };
  const ticket = useTicketByRef(run.projectId, ticketId).data;
  const questions = useTicketQuestions(path).data ?? [];
  const events = useEvents(path).data ?? [];
  return <RunDetail run={run} ticket={ticket} questions={questions} events={events} />;
}

function RunDetail({
  run,
  ticket,
  questions,
  events,
}: {
  run: Run;
  ticket: Pick<Ticket, "key" | "title"> | undefined;
  questions: readonly Question[];
  events: readonly TicketEvent[];
}) {
  const started = run.startedAt ?? run.createdAt;
  const wall = wallMs(run);
  const tokensIn = run.tokensIn ?? run.usage?.inputTokens ?? null;
  const tokensOut = run.tokensOut ?? run.usage?.outputTokens ?? null;
  const active = isActiveRun(run);
  // Ticks while the task runs, so its elapsed time moves between polls (AI-377).
  const now = useNow(active);
  // A task in flight waits on its ticket's open questions; an ended one waits on nothing.
  const waitingOn = active ? questions.filter((q) => q.status === "open") : [];
  const log = httpsHref(run.links.executorRun);
  return (
    <article className="space-y-4 wrap-anywhere" aria-label="Agent task">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {run.ticketId && (
            <Crumbs projectId={run.projectId} ticketId={run.ticketId} ticket={ticket} />
          )}
          <h2 className="text-md font-semibold">
            <span className="sr-only">Agent task ·</span> {STEP_TITLE[run.step]}
          </h2>
          <Badge variant={STATUS_VARIANT[run.status]}>{statusText(run, now)}</Badge>
        </div>
        {log && (
          <Button asChild size="sm" variant="outline" className="h-11 sm:h-8">
            <a href={log} target="_blank" rel="noopener noreferrer">
              Open log
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          </Button>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-6">
        {/* AI-340, AI-377: one sentence first: what it is doing, or how it ended. */}
        <p aria-label="What happened" className="text-base font-semibold lg:col-start-1">
          {runSummary(run, ticket?.key ?? null, now)}
          {waitingOn.length > 0 && ` ${waitingText(waitingOn.length)}`}
        </p>

        <SidePanel run={run} ticket={ticket} active={active} />

        <div className="space-y-4 lg:col-start-1">
          <Timeline entries={timeline(run, events, waitingOn, now)} projectId={run.projectId} />

          {/* The summary already says the first line; the full error shows only when it says more. */}
          {errorReason(run.error)?.more && (
            <p className="whitespace-pre-wrap text-sm text-destructive">{run.error?.trim()}</p>
          )}
          {run.summary && (
            <Section title="Report">
              <Summary text={run.summary} />
            </Section>
          )}
          {run.plan && <Plan plan={run.plan} />}
          {run.verification.length > 0 && <Verification checks={run.verification} />}

          <Facts title="Details">
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
            <Fact label="Branch">{run.branch}</Fact>
          </Facts>

          <Facts title="Usage">
            <Fact label="Tokens in">{countOf(tokensIn)}</Fact>
            <Fact label="Tokens out">{countOf(tokensOut)}</Fact>
            <Fact label="Cache read">{countOf(run.usage?.cacheReadTokens)}</Fact>
            <Fact label="Cache write">{countOf(run.usage?.cacheWriteTokens)}</Fact>
            <Fact label="Turns">{countOf(run.usage?.turns)}</Fact>
          </Facts>
        </div>
      </div>
    </article>
  );
}

/** "Board › AI-3 Story side panel ›": where the task belongs, each part a link. */
function Crumbs({
  projectId,
  ticketId,
  ticket,
}: {
  projectId: string;
  ticketId: string;
  ticket: Pick<Ticket, "key" | "title"> | undefined;
}) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      <Link
        to="/p/$projectId/board"
        params={{ projectId }}
        className="text-muted-foreground hover:text-foreground"
      >
        Board
      </Link>
      <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
      <Link
        to="/p/$projectId/t/$ticketRef"
        params={{ projectId, ticketRef: ticket?.key ?? ticketId }}
        className="truncate text-muted-foreground hover:text-foreground"
      >
        {ticket ? `${ticket.key}: ${ticket.title}` : "Ticket"}
      </Link>
      <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
    </nav>
  );
}

/**
 * Model, quota, cost and PR beside the timeline (below the sentence on a phone): once the task
 * ends, the outcome sentence leads and these follow (AI-377).
 */
function SidePanel({
  run,
  ticket,
  active,
}: {
  run: Run;
  ticket: Pick<Ticket, "key" | "title"> | undefined;
  active: boolean;
}) {
  const quota = run.quotaDelta && formatQuotaDelta(run.quotaDelta);
  const pr = httpsHref(run.links.pullRequest);
  const route = [run.tier && `${run.tier} tier`, run.route.harness, run.route.provider]
    .filter(Boolean)
    .join(" · ");
  return (
    <aside
      aria-label="Cost and links"
      className="space-y-3 self-start rounded-lg border border-border bg-raised p-4 text-sm lg:col-start-2 lg:row-span-2 lg:row-start-1"
    >
      <SideFact label="Model" sub={route}>
        {run.route.model}
      </SideFact>
      <SideFact label={active ? "Quota used so far" : "Quota used"}>
        {quota ?? (active ? "None reported yet" : "Not reported")}
      </SideFact>
      {/* No usage reported means unknown, never $0 (ADR-0046); said once the task ends. */}
      <SideFact label="Cost">
        {run.costUsd !== null ? formatCost(run) : active ? "None reported yet" : "unknown"}
      </SideFact>
      <SideFact label="Pull request">
        {pr ? (
          <a href={pr} target="_blank" rel="noopener noreferrer" className="underline">
            {prLabel(pr)}
          </a>
        ) : (
          "None yet"
        )}
      </SideFact>
      {run.ticketId && (
        <SideFact label="Ticket">
          <Link
            to="/p/$projectId/t/$ticketRef"
            params={{ projectId: run.projectId, ticketRef: ticket?.key ?? run.ticketId }}
            className="underline"
          >
            {ticket ? `${ticket.key}: ${ticket.title}` : "Ticket"}
          </Link>
        </SideFact>
      )}
    </aside>
  );
}

function SideFact({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{children}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** One moment in the task, newest first. `now` is the step in progress; `waiting` holds questions. */
export interface TimelineEntry {
  key: string;
  at: string | null;
  title: string;
  detail?: string;
  tone: "done" | "now" | "failed";
  questions?: readonly Pick<Question, "id" | "text">[];
}

function Timeline({ entries, projectId }: { entries: TimelineEntry[]; projectId: string }) {
  return (
    <ol aria-label="Timeline" className="space-y-0">
      {entries.map((e, i) => (
        <li
          key={e.key}
          aria-current={e.tone === "now" ? "step" : undefined}
          className="grid grid-cols-[4.5rem_1rem_minmax(0,1fr)] gap-x-2 sm:grid-cols-[5.5rem_1rem_minmax(0,1fr)]"
        >
          <span className="pt-0.5 text-sm text-muted-foreground tabular-nums">
            {e.at && <time dateTime={e.at}>{timeOfDay(e.at)}</time>}
          </span>
          {/* The rail: a dot per entry, a line down to the next. */}
          <span aria-hidden className="relative flex justify-center">
            <span
              className={cn(
                "relative z-10 mt-1.5 size-2.5 rounded-full",
                e.tone === "now" && "bg-running ring-4 ring-running/20",
                e.tone === "done" && "bg-success",
                e.tone === "failed" && "bg-destructive",
              )}
            />
            {i < entries.length - 1 && <span className="absolute top-3 bottom-0 w-px bg-border" />}
          </span>
          <div className="space-y-2 pb-4">
            <div>
              <p className="font-medium">{e.title}</p>
              {e.detail && <p className="text-sm text-muted-foreground">{e.detail}</p>}
            </div>
            {e.questions && e.questions.length > 0 && (
              <div className="space-y-2 rounded-lg border border-border bg-raised p-3">
                {e.questions.map((q) => (
                  <div key={q.id} className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-2 text-sm">
                      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-attention" />
                      {q.text}
                    </p>
                  </div>
                ))}
                <Button asChild size="sm" variant="outline" className="h-11 sm:h-8">
                  <Link to="/p/$projectId/inbox" params={{ projectId }}>
                    Answer in inbox
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
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
  summarize: ["Summarizing", "Summarized"],
};

/** The page title per step: "Refine", "Build". */
const STEP_TITLE: Record<RunStep, string> = {
  refine: "Refine",
  plan: "Plan",
  build: "Build",
  review: "Review",
  verify: "Verify",
  scout: "Scout",
  sync: "Sync",
  "plan-project": "Plan the project",
  ideate: "Ideate",
  summarize: "Summarize",
};

const STATUS_WORD: Record<Run["status"], string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Whole minutes once past one: "1 min", "12 min"; seconds before that. */
const about = (ms: number) => elapsed(ms < 60_000 ? ms : Math.round(ms / 60_000) * 60_000);

/** The badge: "Running · 1 min" while it runs (from when it started), "Succeeded · 12 min" after. */
export function statusText(
  run: Pick<Run, "status" | "createdAt" | "startedAt" | "endedAt" | "usage">,
  now: Date,
): string {
  const word = STATUS_WORD[run.status];
  if (run.status === "running") {
    const since = run.startedAt ?? run.createdAt;
    return since ? `${word} · ${about(now.getTime() - Date.parse(since))}` : word;
  }
  const wall = wallMs(run);
  return run.status !== "queued" && wall !== null ? `${word} · ${about(wall)}` : word;
}

/** "It waits on your answer to one question." */
export function waitingText(n: number): string {
  return n === 1
    ? "It waits on your answer to one question."
    : `It waits on your answers to ${count(n)} questions.`;
}

/**
 * The task's steps, newest first, from what the API already returns (AI-377): queued, started,
 * the questions it asked and the PR it opened (ticket events that name it), publishing its branch,
 * how it ended, and while it runs, what it is doing now: waiting on Andy's answer or the step.
 */
export function timeline(
  run: Run,
  events: readonly TicketEvent[],
  waitingOn: readonly Pick<Question, "id" | "text" | "createdAt">[],
  now: Date,
): TimelineEntry[] {
  const [going, done] = STEP_VERBS[run.step];
  const entries: TimelineEntry[] = [];
  if (run.createdAt) {
    const why = run.attempt > 1 ? "Automatic retry" : run.tier ? `${run.tier} tier` : undefined;
    entries.push({ key: "queued", at: run.createdAt, title: "Queued", detail: why, tone: "done" });
  }
  if (run.startedAt) {
    entries.push({
      key: "started",
      at: run.startedAt,
      title: "Started",
      detail: `${run.route.harness} · ${run.route.model}`,
      tone: "done",
    });
  }
  for (const e of events) {
    if (e.runId !== run.id) continue;
    const entry = eventEntry(e);
    if (entry) entries.push(entry);
  }
  if (run.pushGrantedAt) {
    entries.push({
      key: "push",
      at: run.pushGrantedAt,
      title: "Publishing its branch",
      detail: run.branch ?? undefined,
      tone: "done",
    });
  }
  if (run.endedAt || !isActiveRun(run)) {
    const failed = run.status === "failed";
    entries.push({
      key: "ended",
      at: run.endedAt,
      // The reason is in the sentence above; said once.
      title: failed ? "Failed" : run.status === "cancelled" ? "Cancelled" : done,
      tone: failed ? "failed" : "done",
    });
  }
  // Oldest first by time; an entry without one (an end not yet stamped) goes last.
  entries.sort((a, b) => (a.at ?? "\uffff").localeCompare(b.at ?? "\uffff"));
  if (isActiveRun(run)) {
    const since = run.startedAt ?? run.createdAt;
    entries.push(
      waitingOn.length > 0
        ? {
            key: "now",
            at: waitingOn.reduce((t, q) => (q.createdAt > t ? q.createdAt : t), ""),
            title: "Waiting on your answer",
            tone: "now",
            questions: waitingOn,
          }
        : run.status === "queued"
          ? { key: "now", at: null, title: "Waiting to start", tone: "now" }
          : {
              key: "now",
              at: null,
              title: `${going} now`,
              detail: since ? `for ${about(now.getTime() - Date.parse(since))}` : undefined,
              tone: "now",
            },
    );
  }
  return entries.reverse();
}

/** A ticket event the task caused, as a timeline entry; null for events it doesn't show. */
function eventEntry(e: TicketEvent): TimelineEntry | null {
  const base = { key: e.id, at: e.createdAt, tone: "done" as const };
  switch (e.kind) {
    case "question_asked":
      return { ...base, title: "Asked you a question", detail: e.body ?? undefined };
    case "question_answered":
      return { ...base, title: "Got your answer", detail: e.body ?? undefined };
    case "pr_linked": {
      const url = typeof e.data.url === "string" ? e.data.url : null;
      return { ...base, title: url ? `Opened ${prLabel(url)}` : "Opened a pull request" };
    }
    default:
      return null;
  }
}

/** Re-renders every second while `on`, so elapsed times move between polls. */
function useNow(on: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

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
      return `Failed${after}: ${reasonOr(run.error, `${going.toLowerCase()}${what}`)}`;
    }
    case "cancelled":
      return `Cancelled: ${reasonOr(run.error, `${going.toLowerCase()}${what}`)}`;
  }
}

/** The error's first non-blank line as a sentence, else `fallback`: "Checks failed." */
function reasonOr(error: string | null | undefined, fallback: string): string {
  const reason = errorReason(error)?.first ?? fallback;
  return `${reason}${reason.endsWith(".") ? "" : "."}`;
}

/**
 * An error split once for the summary line and the page: its first non-blank line, and whether
 * more lines follow (then the page shows it in full). Null when it says nothing.
 */
export function errorReason(
  error: string | null | undefined,
): { first: string; more: boolean } | null {
  const lines = (error ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  return { first: lines[0]!, more: lines.length > 1 };
}
