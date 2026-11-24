import { WORK_VIEWS, WORK_VIEW_LABELS, type NeedsYouParts, type WorkView } from "@andy/domain";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";

type Chip = { id: WorkView | null; label: string; count: number };

function chipList(
  counts: Record<WorkView, number>,
  needsYou: NeedsYouParts,
  total: number | null,
): Chip[] {
  return [
    ...(total === null ? [] : [{ id: null, label: "All", count: total }]),
    ...WORK_VIEWS.map((id) => ({
      id,
      label: WORK_VIEW_LABELS[id],
      count: id === "needs-me" ? needsYou.tickets : counts[id],
    })),
  ];
}

/** "· 3 tickets · 1 stale · 2 to pick a worker": each extra part only when it is not 0. */
export function needsYouText({ tickets, stale, toPickWorker }: NeedsYouParts): string {
  return [
    `· ${tickets} ticket${tickets === 1 ? "" : "s"}`,
    stale ? ` · ${stale} stale` : "",
    toPickWorker ? ` · ${toPickWorker} to pick a worker` : "",
  ].join("");
}

const countText = (chip: Chip, needsYou: NeedsYouParts) =>
  chip.id === "needs-me" ? needsYouText(needsYou) : String(chip.count);

/**
 * Work view chips (AI-187, ADR-0108): All plus five fixed views, each with its count of open
 * tickets. One is active at a time; the page keeps the choice in the URL. The Work list (AI-198)
 * always shows one view, so it leaves All out (`total` null). Needs you shows the header's number
 * of tickets for the same scope and names the parts it holds or adds: Done tickets with an open
 * question ("· 1 stale", counted but not listed) and tickets only waiting for a worker
 * ("· 2 to pick a worker", listed but not counted) (AI-347, design.md).
 */
export function WorkViewChips({
  view,
  counts,
  needsYou,
  total,
  onChange,
}: {
  view: WorkView | null;
  counts: Record<WorkView, number>;
  needsYou: NeedsYouParts;
  /** Tickets "All" shows; null leaves the All chip out. */
  total: number | null;
  onChange: (view: WorkView | null) => void;
}) {
  return (
    <Segmented
      label="Work view"
      value={view}
      options={chipList(counts, needsYou, total).map((chip) => ({
        value: chip.id,
        label: (
          <>
            {chip.label} <span className="tabular-nums">{countText(chip, needsYou)}</span>
          </>
        ),
      }))}
      onChange={onChange}
    />
  );
}

/** Radix Select can't hold an empty value; this one stands for All. */
const ALL = "all";

/** The same choice as one menu, "View: All 11 ▾", for the phone board (AI-337). */
export function WorkViewMenu({
  view,
  counts,
  needsYou,
  total,
  onChange,
}: {
  view: WorkView | null;
  counts: Record<WorkView, number>;
  needsYou: NeedsYouParts;
  total: number;
  onChange: (view: WorkView | null) => void;
}) {
  return (
    <Select value={view ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : (v as WorkView))}>
      <SelectTrigger aria-label="View" className="w-auto">
        <span className="text-muted-foreground">View</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {chipList(counts, needsYou, total).map((chip) => (
          <SelectItem key={chip.id ?? ALL} value={chip.id ?? ALL}>
            {chip.label} {countText(chip, needsYou)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
