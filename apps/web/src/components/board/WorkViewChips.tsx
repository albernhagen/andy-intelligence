import { WORK_VIEWS, WORK_VIEW_LABELS, type WorkView } from "@andy/domain";

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
    <div role="group" aria-label="Work view" className="flex flex-wrap gap-2">
      {chips.map(({ id, label, count }) => {
        const active = id === view;
        return (
          <button
            key={id ?? "all"}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(id)}
            className={`flex items-center gap-1.5 h-11 rounded-full border px-3 text-sm sm:h-8 focus-visible:outline-2 focus-visible:outline-ring ${
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-foreground/10"
            }`}
          >
            {label}{" "}
            <span className={`tabular-nums ${active ? "" : "text-muted-foreground"}`}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
