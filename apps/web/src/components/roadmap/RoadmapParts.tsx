import { Link } from "@tanstack/react-router";
import { MilestoneStatus } from "@andy/contracts";
import { MILESTONE_STATUS } from "@/components/MilestoneControls";
import { QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import { useSetMilestoneStatus } from "@/lib/queries";
import type { ChildEpic, Counts, Epic, Milestone } from "@/lib/roadmap";
import { cn } from "@/lib/utils";

/**
 * Pieces the roadmap (AI-202) and the milestone page (AI-405) share: a milestone's summary and
 * status pick, an epic's row, progress and open-ticket chips.
 */

/** A milestone's name, outcome, progress and counts: its roadmap row, and the row's dragged copy. */
export function MilestoneSummary({ milestone: m }: { milestone: Milestone }) {
  const status = MILESTONE_STATUS[m.done ? "done" : m.status];
  return (
    <>
      <span className="min-w-0 flex-1 basis-48">
        <span className="block font-medium">{m.name}</span>
        {!m.done && <span className="block text-muted-foreground">{m.outcome}</span>}
      </span>
      {m.done && <Badge variant={status.variant}>{status.label}</Badge>}
      <Progress done={m.progress.done} total={m.progress.total} />
      {!m.done && <CountChips counts={m.counts} />}
    </>
  );
}

const EPIC_STATE: Record<Epic["state"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  waiting_for_check: "Waiting for your check",
  done: "Done",
};

/** A milestone's (or No milestone's) epics, each followed by its child epics, indented. */
export function EpicList({ epics, projectId }: { epics: Epic[]; projectId: string }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-raised">
      {epics.flatMap((e) => [
        <EpicRow key={e.key} epic={e} projectId={projectId} />,
        ...e.children.map((c) => (
          <EpicRow key={c.key} epic={c} parentKey={e.key} projectId={projectId} />
        )),
      ])}
    </ul>
  );
}

/** One epic as a list row: see `EpicSummary`. */
export function EpicRow({
  epic: e,
  parentKey,
  projectId,
}: {
  epic: Epic | ChildEpic;
  /** Set for a child epic: it is indented under this epic. */
  parentKey?: string;
  projectId: string;
}) {
  return (
    <li
      data-epic={e.key}
      data-parent-epic={parentKey}
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm",
        parentKey && "pl-8",
      )}
    >
      <EpicSummary epic={e} parentKey={parentKey} projectId={projectId} />
    </li>
  );
}

/** One epic: key and title linking to its panel, state, outcome, progress and open counts. */
export function EpicSummary({
  epic: e,
  parentKey,
  projectId,
}: {
  epic: Epic | ChildEpic;
  parentKey?: string;
  projectId: string;
}) {
  return (
    <>
      <Link
        to="/p/$projectId/t/$ticketRef"
        params={{ projectId, ticketRef: e.key }}
        className="min-w-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {parentKey && (
          <span className="text-xs text-muted-foreground" aria-label={`under ${parentKey}`}>
            ↳{" "}
          </span>
        )}
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{e.key}</span>{" "}
        {e.title}
      </Link>
      <span className="text-xs text-muted-foreground">{EPIC_STATE[e.state]}</span>
      {e.outcome && (
        <span className="min-w-0 flex-1 text-xs text-muted-foreground max-sm:basis-full">
          {e.outcome}
        </span>
      )}
      <Progress done={e.progress.done} total={e.progress.total} />
      {e.state !== "done" && <CountChips counts={e.counts} />}
    </>
  );
}

/** "14 of 23 done", with a thin bar beside it (the number is what to read). */
export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
      <span
        role="progressbar"
        aria-label={`${done} of ${total} done`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1 w-16 overflow-hidden rounded-full bg-muted"
      >
        <span className="block h-full bg-success" style={{ width: `${pct}%` }} />
      </span>
      {done} of {total} done
    </span>
  );
}

/** A chip per non-zero count of open tickets: "2 need you", "3 in review", "1 blocked". */
export function CountChips({ counts }: { counts: Counts }) {
  const chips: [number, string, "attention" | "running" | "danger" | "default"][] = [
    [counts.needsYou, counts.needsYou === 1 ? "needs you" : "need you", "attention"],
    [counts.inReview, "in review", "default"],
    [counts.inProgress, "in progress", "running"],
    [counts.blocked, "blocked", "danger"],
  ];
  return (
    <span className="flex flex-wrap gap-1">
      {chips
        .filter(([n]) => n > 0)
        .map(([n, label, variant]) => (
          <Badge key={label} variant={variant} className="tabular-nums">
            {n} {label}
          </Badge>
        ))}
    </span>
  );
}

/**
 * The owner's status pick for one milestone (AI-378; the mockup's Approved | Parked): saved on
 * click, the API's refusal shown. Every write goes through the milestone route (AI-304).
 */
export function StatusPick({
  projectId,
  milestone: m,
}: {
  projectId: string;
  milestone: Pick<Milestone, "id" | "name" | "status">;
}) {
  const set = useSetMilestoneStatus(projectId);
  return (
    <div className={cn("space-y-1", set.isPending && "opacity-60")}>
      <Segmented
        label={`Status of ${m.name}`}
        value={m.status}
        options={MilestoneStatus.options.map((s) => ({
          value: s,
          label: MILESTONE_STATUS[s].label,
        }))}
        onChange={(status) => {
          if (status !== m.status && !set.isPending) set.mutate({ milestoneId: m.id, status });
        }}
      />
      {set.error && <QueryError error={set.error} />}
    </div>
  );
}
