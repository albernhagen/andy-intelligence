import { useState, type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowDownUp, ChevronsLeftRight, ChevronsRightLeft, ListFilter } from "lucide-react";
import {
  Confidence,
  Risk,
  Size,
  type Milestone,
  type ReadyFilters,
  type Stage,
} from "@andy/contracts";
import { Segmented } from "@/components/ui/segmented";
import { MilestoneChip } from "@/components/MilestoneControls";
import { STAGE_LABELS } from "@/lib/tickets";

/**
 * A labelled part of a lane (Backlog's Up next and Ideas); a drop on it lands in that part. `hint`
 * shows under the label while the part is empty, e.g. what a drop there does.
 */
export function LaneZone({
  id,
  label,
  count,
  hint,
}: {
  id: string;
  label: string;
  count: number;
  hint?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <li
      ref={setNodeRef}
      data-zone={id}
      className={`flex flex-col rounded-md px-1 py-0.5 ${isOver ? "bg-selected" : ""}`}
    >
      <span className="flex h-6 items-center gap-1 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{count}</span>
      </span>
      {hint && count === 0 && (
        <span className="pb-1 text-xs text-muted-foreground max-sm:hidden">{hint}</span>
      )}
    </li>
  );
}

/**
 * A group header inside a lane when the board is grouped by epic (AI-86): the epic's key, title
 * and how many of its children are done, or "No epic"; its milestone and status when it has one
 * (AI-311). Not a drop target: rank stays per lane.
 */
export function EpicGroupHeader({
  epic,
  progress,
  milestone = null,
}: {
  epic: { key: string; title: string } | null;
  progress: { done: number; total: number } | null;
  /** The epic's milestone (its top-level epic's, ADR-0131), shown with its status (AI-311). */
  milestone?: Pick<Milestone, "name" | "status"> | null;
}) {
  return (
    <li
      data-epic={epic?.key ?? "none"}
      className="flex min-h-6 flex-wrap items-center gap-x-1 gap-y-0.5 px-1 py-0.5 text-xs text-muted-foreground"
    >
      {epic ? (
        <>
          <span className="font-medium text-foreground">{epic.key}</span>
          <span className="min-w-0 flex-1 truncate" title={epic.title}>
            {epic.title}
          </span>
          {progress && (
            <span className="shrink-0 tabular-nums">
              {progress.done} of {progress.total} done
            </span>
          )}
          {/* Its own line, so the epic's title and the milestone's status both stay readable. */}
          {milestone && (
            <span className="flex basis-full">
              <MilestoneChip milestone={milestone} className="max-w-full" />
            </span>
          )}
        </>
      ) : (
        <span className="font-medium">No epic</span>
      )}
    </li>
  );
}

/** Ready's view switch: queue order, or easiest first by score. The URL holds it (`?sort=score`). */
export function ReadySortToggle({ sorted, onToggle }: { sorted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={sorted}
      onClick={onToggle}
      className="inline-flex h-11 items-center gap-1 rounded-md px-1 text-left text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:h-6"
    >
      <ArrowDownUp className="size-3" aria-hidden />
      {sorted ? "Sorted by score · show queue order" : "Sort by score"}
    </button>
  );
}

const READY_FILTERS = [
  { key: "size", label: "Size", options: Size.options },
  { key: "risk", label: "Risk", options: Risk.options },
  { key: "confidence", label: "Confidence", options: Confidence.options },
] as const;

/**
 * The Ready lane's filters (AI-343, moved from the Ready page): size, risk and confidence, the
 * same as MCP `list_ready`. They hide cards only; a ticket without the score a filter asks for
 * is hidden. A small button opens them; it says how many are on.
 */
export function ReadyFilterMenu({
  filters,
  onChange,
}: {
  filters: ReadyFilters;
  onChange: (next: ReadyFilters) => void;
}) {
  const on = READY_FILTERS.filter((f) => filters[f.key]).length;
  const [open, setOpen] = useState(on > 0);
  // A fragment: the button sits beside "Sort by score"; the open filters wrap onto their own line.
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex h-11 items-center gap-1 rounded-md px-1 text-left text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:h-6"
      >
        <ListFilter className="size-3" aria-hidden />
        {on ? `Filter · ${on}` : "Filter"}
      </button>
      {open && (
        <div
          role="group"
          aria-label="Ready filters"
          className="flex w-full flex-col gap-1 rounded-md border border-border bg-raised p-2"
        >
          {/* Every option shows (fewer than six): a toggle per filter, Any first (design.md). */}
          {READY_FILTERS.map((f) => (
            <div key={f.key} className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{f.label}</span>
              <Segmented
                label={f.label}
                value={filters[f.key] ?? null}
                className="[&>button]:h-11 [&>button]:px-2 [&>button]:text-xs sm:[&>button]:h-6"
                options={[
                  { value: null, label: "Any" },
                  ...f.options.map((o) => ({ value: o, label: o })),
                ]}
                onChange={(value) => onChange({ ...filters, [f.key]: value ?? undefined })}
              />
            </div>
          ))}
          {on > 0 && (
            <button
              type="button"
              onClick={() => onChange({ size: undefined, risk: undefined, confidence: undefined })}
              className="self-start rounded-md px-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring max-sm:min-h-11"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </>
  );
}

/**
 * One swim lane per stage: a header with the count, then the cards in rank order (the order is
 * the priority, ADR-0058). A collapsed lane is a narrow strip with its count; it still takes
 * drops. `onToggle` makes the header (or the strip) expand or collapse it. `fill` is the phone
 * board's one lane (AI-337): full width, no header, since the stage tabs above name it.
 */
export function Lane({
  stage,
  ids,
  collapsed,
  onToggle,
  highlight,
  top,
  fill = false,
  children,
}: {
  stage: Stage;
  ids: string[];
  collapsed: boolean;
  onToggle?: () => void;
  highlight: boolean;
  /** Above the cards, e.g. Backlog's quick add. */
  top?: ReactNode;
  fill?: boolean;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: stage });
  const label = STAGE_LABELS[stage];
  // Sunken lanes under raised cards (design-details.md); a lane under a dragged card lights up.
  const surface = `border border-border ${highlight ? "bg-selected" : "bg-muted"}`;

  if (collapsed) {
    return (
      <section
        ref={setNodeRef}
        aria-label={label}
        data-stage={stage}
        className={`w-10 shrink-0 rounded-lg ${surface}`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          aria-label={`Show ${label}, ${ids.length}`}
          className="flex h-full w-full flex-col items-center gap-2 rounded-lg py-3 text-sm hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="text-xs text-muted-foreground tabular-nums">{ids.length}</span>
          <span className="font-medium [writing-mode:vertical-rl]">{label}</span>
          <ChevronsLeftRight className="size-3.5 text-muted-foreground" aria-hidden />
        </button>
      </section>
    );
  }

  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      data-stage={stage}
      className={`flex shrink-0 flex-col gap-1.5 rounded-lg p-2 ${fill ? "w-full" : "w-64 xl:w-auto xl:min-w-44 xl:flex-1 xl:shrink"} ${surface}`}
    >
      <h3
        className={`${fill ? "sr-only" : "flex"} h-6 items-center gap-1.5 px-1 text-sm font-medium`}
      >
        {label} <span className="text-xs text-muted-foreground tabular-nums">{ids.length}</span>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded
            aria-label={`Collapse ${label}`}
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronsRightLeft className="size-3.5" aria-hidden />
          </button>
        )}
      </h3>
      {top}
      <SortableContext id={stage} items={ids} strategy={verticalListSortingStrategy}>
        <ol className="flex min-h-8 flex-col gap-1.5">{children}</ol>
      </SortableContext>
    </section>
  );
}
