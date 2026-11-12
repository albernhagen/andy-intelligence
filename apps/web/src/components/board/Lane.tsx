import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronsLeftRight, ChevronsRightLeft } from "lucide-react";
import type { Stage } from "@andy/contracts";
import { STAGE_LABELS } from "@/lib/tickets";

/** A labelled part of a lane (Backlog's Up next and Ideas); a drop on it lands in that part. */
export function LaneZone({ id, label, count }: { id: string; label: string; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <li
      ref={setNodeRef}
      data-zone={id}
      className={`flex h-7 items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground ${
        isOver ? "bg-foreground/15" : "border-b border-border"
      }`}
    >
      {label} <span className="tabular-nums">{count}</span>
    </li>
  );
}

/**
 * A group header inside a lane when the board is grouped by epic (AI-86): the epic's key, title
 * and how many of its children are done, or "No epic". Not a drop target: rank stays per lane.
 */
export function EpicGroupHeader({
  epic,
  progress,
}: {
  epic: { key: string; title: string } | null;
  progress: { done: number; total: number } | null;
}) {
  return (
    <li
      data-epic={epic?.key ?? "none"}
      className="flex h-6 items-center gap-1 px-1 text-xs text-muted-foreground"
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
      className="rounded-md px-1 text-left text-xs text-muted-foreground hover:bg-foreground/10"
    >
      {sorted ? "Sorted by score · show queue order" : "Sort by score"}
    </button>
  );
}

/**
 * One swim lane per stage: a header with the count, then the cards in rank order (the order is
 * the priority, ADR-0058). A collapsed lane is a narrow strip with its count; it still takes
 * drops. `onToggle` makes the header (or the strip) expand or collapse it.
 */
export function Lane({
  stage,
  ids,
  collapsed,
  onToggle,
  highlight,
  top,
  children,
}: {
  stage: Stage;
  ids: string[];
  collapsed: boolean;
  onToggle?: () => void;
  highlight: boolean;
  /** Above the cards, e.g. Backlog's quick add. */
  top?: ReactNode;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: stage });
  const label = STAGE_LABELS[stage];
  const surface = highlight ? "bg-foreground/15" : "bg-muted";

  if (collapsed) {
    return (
      <section
        ref={setNodeRef}
        aria-label={label}
        data-stage={stage}
        className={`w-10 shrink-0 rounded-md ${surface}`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          aria-label={`Show ${label}, ${ids.length}`}
          className="flex h-full w-full flex-col items-center gap-2 py-2 text-sm hover:bg-foreground/5"
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
      className={`flex w-64 shrink-0 flex-col gap-2 rounded-md p-2 xl:w-auto xl:min-w-44 xl:flex-1 xl:shrink ${surface}`}
    >
      <h3 className="flex h-6 items-center gap-1 text-sm font-medium">
        {label} <span className="text-xs text-muted-foreground tabular-nums">{ids.length}</span>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded
            aria-label={`Collapse ${label}`}
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-foreground/10"
          >
            <ChevronsRightLeft className="size-3.5" aria-hidden />
          </button>
        )}
      </h3>
      {top}
      <SortableContext id={stage} items={ids} strategy={verticalListSortingStrategy}>
        <ol className="flex min-h-8 flex-col gap-2">{children}</ol>
      </SortableContext>
    </section>
  );
}
