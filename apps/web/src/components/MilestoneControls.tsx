import { MilestoneStatus, type Milestone, type Ticket } from "@andy/contracts";
import { milestoneOf, topLevelOf } from "@andy/domain";
import { QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  useMilestones,
  useSetEpicMilestone,
  useSetMilestoneStatus,
  useTickets,
} from "@/lib/queries";

/**
 * A milestone and its status where epics show (ADR-0131 row "UI", AI-311: M4.38): the chip on
 * the epic panel and the board's epic groups, and the owner's controls. Every write goes through
 * the milestone routes (AI-304), so the API refuses anyone but the owner and logs each change.
 */

type Shown = Pick<Milestone, "name" | "status">;

export const MILESTONE_STATUS: Record<
  MilestoneStatus | "done",
  { label: string; variant: "default" | "success" | "attention" }
> = {
  not_reviewed: { label: "Not reviewed", variant: "attention" },
  approved: { label: "Approved", variant: "default" },
  parked: { label: "Parked", variant: "default" },
  done: { label: "Done", variant: "success" },
};

/** "M6: Dev → prod releases · Parked". */
export function milestoneChipText(m: Shown): string {
  return `${m.name} · ${MILESTONE_STATUS[m.status].label}`;
}

export function MilestoneChip({
  milestone: m,
  className,
}: {
  milestone: Shown;
  className?: string;
}) {
  return (
    <Badge
      variant={MILESTONE_STATUS[m.status].variant}
      data-milestone-status={m.status}
      title={milestoneChipText(m)}
      className={cn("min-w-0", className)}
    >
      {/* A long name shortens; the status always shows. */}
      <span className="truncate">{m.name}</span>
      <span className="shrink-0 whitespace-pre"> · {MILESTONE_STATUS[m.status].label}</span>
    </Badge>
  );
}

/** The owner's status pick for one milestone: saved on change, the API's refusal shown. */
export function MilestoneStatusSelect({
  projectId,
  milestone: m,
}: {
  projectId: string;
  milestone: Pick<Milestone, "id" | "name" | "status">;
}) {
  const set = useSetMilestoneStatus(projectId);
  return (
    <div className="space-y-1">
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Milestone status</span>
        <Select
          className="h-8"
          aria-label={`Status of ${m.name}`}
          value={m.status}
          disabled={set.isPending}
          onChange={(e) =>
            set.mutate({ milestoneId: m.id, status: MilestoneStatus.parse(e.target.value) })
          }
        >
          {MilestoneStatus.options.map((s) => (
            <option key={s} value={s}>
              {MILESTONE_STATUS[s].label}
            </option>
          ))}
        </Select>
      </label>
      {set.error && <QueryError error={set.error} />}
    </div>
  );
}

/**
 * The epic panel's milestone: a top-level epic picks one and sets its status; a child epic or a
 * ticket shows the one it takes from its top-level epic.
 */
export function TicketMilestone({ ticket: t }: { ticket: Ticket }) {
  const tickets = useTickets(t.projectId).data;
  const milestones = useMilestones(t.projectId);
  if (!tickets || !milestones.data) return null;
  const top = topLevelOf(t, tickets);
  const id = milestoneOf(t, tickets);
  const milestone = milestones.data.find((m) => m.id === id) ?? null;
  const own = t.type === "epic" && top.id === t.id;
  if (!own && !milestone) return null;
  return (
    <section aria-label="Milestone" className="space-y-2">
      {own ? (
        <EpicMilestonePick ticket={t} milestones={milestones.data} />
      ) : (
        <span className="text-xs text-muted-foreground">Milestone</span>
      )}
      {milestone && (
        <p className="flex min-w-0 flex-wrap items-center gap-1">
          <MilestoneChip milestone={milestone} className="max-w-full" />
          {!own && <span className="text-xs text-muted-foreground">from {top.key}</span>}
        </p>
      )}
      {milestone && own && <MilestoneStatusSelect projectId={t.projectId} milestone={milestone} />}
    </section>
  );
}

function EpicMilestonePick({ ticket: t, milestones }: { ticket: Ticket; milestones: Milestone[] }) {
  const set = useSetEpicMilestone({ projectId: t.projectId, ticketId: t.id });
  return (
    <div className="space-y-1">
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Milestone</span>
        <Select
          className="h-8"
          value={t.milestoneId ?? ""}
          disabled={set.isPending}
          onChange={(e) => set.mutate(e.target.value || null)}
        >
          <option value="">No milestone</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </label>
      {set.error && <QueryError error={set.error} />}
    </div>
  );
}
