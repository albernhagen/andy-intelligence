import { WORK_VIEWS, WORK_VIEW_LABELS, type WorkView } from "@andy/domain";
import { Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";

type Chip = { id: WorkView | null; label: string; count: number };

function chipList(counts: Record<WorkView, number>, total: number | null): Chip[] {
  return [
    ...(total === null ? [] : [{ id: null, label: "All", count: total }]),
    ...WORK_VIEWS.map((id) => ({ id, label: WORK_VIEW_LABELS[id], count: counts[id] })),
  ];
}

const countText = ({ id, count }: Chip) =>
  id === "needs-me" ? `· ${count} ticket${count === 1 ? "" : "s"}` : String(count);

/**
 * Work view chips (AI-187, ADR-0108): All plus five fixed views, each with its count of open
 * tickets. One is active at a time; the page keeps the choice in the URL. The Work list (AI-198)
 * always shows one view, so it leaves All out (`total` null). Needs you names its unit, "· 4 tickets",
 * because the header's "Needs you N" counts things to answer, not tickets (AI-326, design.md).
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
  return (
    <Segmented
      label="Work view"
      value={view}
      options={chipList(counts, total).map((chip) => ({
        value: chip.id,
        label: (
          <>
            {chip.label} <span className="tabular-nums">{countText(chip)}</span>
          </>
        ),
      }))}
      onChange={onChange}
    />
  );
}

/** The same choice as one menu, "View: All 11 ▾", for the phone board (AI-337). */
export function WorkViewMenu({
  view,
  counts,
  total,
  onChange,
}: {
  view: WorkView | null;
  counts: Record<WorkView, number>;
  total: number;
  onChange: (view: WorkView | null) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      View
      <Select
        className="h-11 w-auto text-base"
        value={view ?? ""}
        onChange={(e) => onChange((e.target.value || null) as WorkView | null)}
      >
        {chipList(counts, total).map((chip) => (
          <option key={chip.id ?? "all"} value={chip.id ?? ""}>
            {chip.label} {countText(chip)}
          </option>
        ))}
      </Select>
    </label>
  );
}
