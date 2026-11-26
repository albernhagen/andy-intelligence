import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BREAKDOWN_LIMITS,
  type EpicBreakdown,
  type Milestone,
  type Run,
  type Ticket,
} from "@andy/contracts";
import { isInFlight, wasDispatched } from "@andy/domain";
import { MILESTONE_STATUS } from "@/components/MilestoneControls";
import { RejectControls } from "@/components/ProjectPlan";
import { QueryError } from "@/components/Status";
import { TypeMarker } from "@/components/TicketMarkers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { unwrap, useApi } from "@/lib/api";
import { useLivePoll } from "@/lib/live";
import { useMilestones, useRuns } from "@/lib/queries";

/**
 * Epic breakdowns (AI-383, ADR-0155): on a top-level epic's panel, "Draft tickets" starts a
 * plan-epic agent task; its drafted tickets wait here (and in the inbox) until Andy approves them
 * (they land under the epic in Ideas) or sends them back with a note. Every drafted field is
 * untrusted agent output: shown as plain text, never markdown.
 */

type TicketPath = { projectId: string; ticketId: string };

export function useEpicBreakdown(path: TicketPath, enabled = true) {
  const api = useApi();
  return useQuery({
    // Polled, so a draft a plan-epic task proposes shows without a reload.
    ...useLivePoll("slow"),
    enabled,
    queryKey: ["epic-breakdown", path],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/projects/{projectId}/tickets/{ticketId}/breakdown", {
          params: { path },
        }),
      ),
  });
}

/** Breakdowns waiting for Andy (every project's, or one project's), for the inbox. */
export function useWaitingBreakdowns(projectId?: string) {
  const api = useApi();
  const waiting = useQuery({
    ...useLivePoll("slow"),
    queryKey: ["epic-breakdowns-waiting"],
    queryFn: async () => unwrap(await api.GET("/api/epic-breakdowns/waiting")),
  });
  const shown = (waiting.data ?? []).filter((w) => !projectId || w.projectId === projectId);
  return { shown, error: waiting.error, refetch: waiting.refetch };
}

/**
 * Why "Draft tickets" can't start, or null when it can. The client's copy of the API's checks
 * (`EpicBreakdownService.checkStartable`, `RunService.requestEpicTask`); the dial and global caps
 * are only known to the API, so a click can still be refused with its message.
 */
export function draftBlocker(
  epic: Pick<Ticket, "key" | "stage" | "archived" | "milestoneId">,
  milestones: Milestone[],
  drafts: Pick<Run, "executor" | "localRun">[],
): string | null {
  if (epic.archived) return `${epic.key} is archived.`;
  if (epic.stage === "cancelled" || epic.stage === "done")
    return `${epic.key} is ${epic.stage === "done" ? "done" : "cancelled"}.`;
  const milestone = milestones.find((m) => m.id === epic.milestoneId);
  if (!milestone) return "Pick a milestone for this epic first.";
  if (milestone.status !== "approved")
    return `${milestone.name} is ${MILESTONE_STATUS[milestone.status].label.toLowerCase()}: approve it on the roadmap first.`;
  if (drafts.filter(wasDispatched).length >= BREAKDOWN_LIMITS.draftsPerEpic)
    return `Used its ${BREAKDOWN_LIMITS.draftsPerEpic} drafting tasks: write the tickets by hand, or submit them over MCP (submit_epic_breakdown).`;
  return null;
}

/** The epic panel's breakdown: only on a top-level epic. */
export function EpicBreakdownPanel({ ticket }: { ticket: Ticket }) {
  const topLevel = ticket.type === "epic" && ticket.parentId === null;
  if (!topLevel) return null;
  return <TopLevelBreakdown ticket={ticket} />;
}

function TopLevelBreakdown({ ticket }: { ticket: Ticket }) {
  const path = { projectId: ticket.projectId, ticketId: ticket.id };
  const breakdown = useEpicBreakdown(path);
  const milestones = useMilestones(ticket.projectId);
  const runs = useRuns(path);
  if (breakdown.error)
    return (
      <QueryError
        error={breakdown.error}
        what="the epic's breakdown"
        onRetry={() => void breakdown.refetch()}
      />
    );
  if (!breakdown.data || !milestones.data || !runs.data) return null;
  const current = breakdown.data.breakdown;
  const drafts = runs.data.filter((r) => r.step === "plan-epic");
  const drafting = drafts.find((r) => isInFlight(r, new Date()));
  return (
    <section aria-label="Breakdown" className="space-y-2 rounded-md border border-border p-3">
      <h3 className="text-sm font-medium">Breakdown</h3>
      {current && (current.status === "proposed" || current.status === "approving") ? (
        <WaitingBreakdown path={path} breakdown={current} />
      ) : current?.status === "approved" ? (
        <p className="text-sm">
          Approved: {current.ticketIds.length}{" "}
          {current.ticketIds.length === 1 ? "ticket" : "tickets"} created in Ideas.
        </p>
      ) : drafting ? (
        <p className="text-sm">
          <Link
            to="/p/$projectId/runs/$runId"
            params={{ projectId: ticket.projectId, runId: drafting.id }}
            className="underline underline-offset-2"
          >
            Agent task · plan-epic
          </Link>{" "}
          is drafting tickets. They show here for you to approve.
        </p>
      ) : (
        <>
          {current?.status === "rejected" && (
            <p className="text-sm">
              Sent back: <span className="whitespace-pre-wrap">{current.reason}</span>
            </p>
          )}
          <StartDraft
            path={path}
            blocker={draftBlocker(ticket, milestones.data, drafts)}
            again={current?.status === "rejected"}
          />
        </>
      )}
    </section>
  );
}

/** "Draft tickets": starts a plan-epic agent task, or says why it can't. */
function StartDraft({
  path,
  blocker,
  again,
}: {
  path: TicketPath;
  blocker: string | null;
  again: boolean;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/api/projects/{projectId}/tickets/{ticketId}/breakdown/agent-task", {
          params: { path },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-11 sm:h-8"
        disabled={blocker !== null || start.isPending}
        aria-describedby="draft-tickets-note"
        onClick={() => start.mutate()}
      >
        {again ? "Draft tickets again" : "Draft tickets"}
      </Button>
      <p id="draft-tickets-note" className="text-xs text-muted-foreground">
        {blocker ??
          `An agent drafts this epic's tickets (up to ${BREAKDOWN_LIMITS.tickets}) for you to approve; uses Claude quota.`}
      </p>
      {start.error && <QueryError error={start.error} />}
    </div>
  );
}

/** A waiting draft: the summary, each drafted ticket, then Approve and Send back. */
function WaitingBreakdown({ path, breakdown }: { path: TicketPath; breakdown: EpicBreakdown }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { tickets } = breakdown.proposal;
  const approving = breakdown.status === "approving";
  const decide = useMutation({
    mutationFn: async (body: { decision: "approved" } | { decision: "rejected"; reason: string }) =>
      unwrap(
        await api.POST("/api/projects/{projectId}/tickets/{ticketId}/breakdown/decision", {
          params: { path },
          body,
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  return (
    <div className="space-y-3 text-sm">
      <p className="whitespace-pre-wrap">{breakdown.proposal.summary}</p>
      <ol aria-label="Drafted tickets" className="space-y-2">
        {tickets.map((t, i) => (
          <li
            key={i}
            aria-label={`${i + 1}. ${t.title}`}
            className="space-y-1 rounded-md border border-border bg-raised p-2"
          >
            <p className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
              <span className="min-w-0 flex-1 font-medium wrap-anywhere">{t.title}</span>
              <TypeMarker type={t.type} />
              <Badge>{t.size}</Badge>
            </p>
            <p className="text-xs whitespace-pre-wrap text-muted-foreground">
              Size: {t.sizeReason}
            </p>
            <p className="whitespace-pre-wrap wrap-anywhere">{t.body}</p>
            <ul aria-label="Acceptance criteria" className="list-disc space-y-0.5 pl-5">
              {t.acceptanceCriteria.map((c, j) => (
                <li key={j} className="whitespace-pre-wrap wrap-anywhere">
                  {c}
                </li>
              ))}
            </ul>
            {t.touches.length > 0 && (
              <p className="text-xs text-muted-foreground wrap-anywhere">
                Touches: {t.touches.join(", ")}
              </p>
            )}
            {t.blockedBy.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Blocked by:{" "}
                {t.blockedBy.map((b) => `${b + 1}. ${tickets[b]?.title ?? "?"}`).join("; ")}
              </p>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="h-11 sm:h-8"
          disabled={decide.isPending}
          onClick={() => decide.mutate({ decision: "approved" })}
        >
          {approving
            ? `Finish approval: ${breakdown.ticketIds.length} of ${tickets.length} tickets created`
            : `Approve: create ${tickets.length} ${tickets.length === 1 ? "ticket" : "tickets"}`}
        </Button>
        {!approving && (
          <RejectControls
            decide={(reason) => decide.mutate({ decision: "rejected", reason })}
            pending={decide.isPending}
            action="Send back"
            inputLabel="Note for the next draft"
            placeholder="What to change? (required)"
          />
        )}
      </div>
      {decide.error && <QueryError error={decide.error} />}
    </div>
  );
}

/** Every waiting breakdown (or one project's), for the inbox: each links to its epic's panel. */
export function EpicBreakdownsWaiting({ projectId }: { projectId?: string }) {
  const { shown, error, refetch } = useWaitingBreakdowns(projectId);
  if (error)
    return (
      <QueryError error={error} what="the waiting epic breakdowns" onRetry={() => void refetch()} />
    );
  if (shown.length === 0) return null;
  return (
    <section aria-label="Epic breakdowns" className="space-y-1">
      <h3 className="px-2 text-xs font-medium text-muted-foreground">
        Epic breakdowns <span className="tabular-nums">{shown.length}</span>
      </h3>
      <ul className="space-y-0.5">
        {shown.map((w) => {
          const n = w.breakdown.proposal.tickets.length;
          return (
            <li key={w.epicId}>
              <Link
                to="/p/$projectId/t/$ticketRef"
                params={{ projectId: w.projectId, ticketRef: w.epicKey }}
                className="flex min-h-11 flex-col justify-center rounded-md px-2 py-1 hover:bg-muted sm:min-h-8"
              >
                <span className="min-w-0 truncate text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{w.epicKey}:</span>{" "}
                  {w.epicTitle}
                </span>
                <span className="text-xs text-muted-foreground">
                  {n} {n === 1 ? "ticket" : "tickets"} drafted, waiting for you
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
