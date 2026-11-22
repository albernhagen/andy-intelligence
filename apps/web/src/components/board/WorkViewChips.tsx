import { WORK_VIEWS, WORK_VIEW_LABELS, type WorkView } from "@andy/domain";
import { Segmented } from "@/components/ui/segmented";

/**
 * Work view chips (AI-187, ADR-0108): All plus five fixed views, each with its count of open
 * tickets. One is active at a time; the page keeps the choice in the URL. The Work list (AI-198)
 * always shows one view, so it leaves All out (`total` null).
 */
export function WorkViewChips({
  view,
  counts,
  total,
  onChange,
}: {
  view: WorkView | null;
  counts: Record<WorkView, number>;
  /** Tickets "All" shows; null leaves the All chip out. */
  total: number | null;
  onChange: (view: WorkView | null) => void;
}) {
  const chips: { id: WorkView | null; label: string; count: number }[] = [
    ...(total === null ? [] : [{ id: null, label: "All", count: total }]),
    ...WORK_VIEWS.map((id) => ({ id, label: WORK_VIEW_LABELS[id], count: counts[id] })),
  ];
  return (
    <Segmented
      label="Work view"
      value={view}
      options={chips.map(({ id, label, count }) => ({
        value: id,
        label: (
          <>
            {label} <span className="tabular-nums">{count}</span>
          </>
        ),
      }))}
      onChange={onChange}
    />
  );
}
