import {
  Stage,
  compareRanks,
  type Run,
  type Ticket,
  type TicketEvent,
  type TicketType,
} from "@andy/contracts";
import { ARCHIVABLE_STAGES, TRANSITIONS } from "@andy/domain";

export { sortQuestions } from "@andy/domain";

/** Board columns, in workflow order (ARCHITECTURE §4.1). */
export const STAGES: readonly Stage[] = Stage.options;

export const STAGE_LABELS: Record<Stage, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In progress",
  ready_for_review: "Ready for review",
  done: "Done",
  cancelled: "Cancelled",
};

/** Ticket types (ADR-0058: Ticket model). */
export const TYPE_LABELS: Record<TicketType, string> = {
  feature: "Feature",
  chore: "Chore",
  bug: "Bug",
  epic: "Epic",
};

/** A ticket's type for display; empty until Andy or refine sets one. */
export function typeLabel(type: TicketType | null): string {
  return type === null ? "No type" : TYPE_LABELS[type];
}

/** The board hides archived tickets unless Andy asks for them (AI-15: Cancel and archive tickets). */
export function visibleTickets<T extends Ticket>(
  tickets: readonly T[],
  showArchived: boolean,
): T[] {
  return showArchived ? [...tickets] : tickets.filter((t) => !t.archived);
}

/** Whether the ticket can be archived now: only Done or Cancelled tickets. */
export function canArchive(ticket: Pick<Ticket, "stage">): boolean {
  return ARCHIVABLE_STAGES.includes(ticket.stage);
}

/** Groups tickets into every stage column (empty ones included), each sorted by rank. */
export function groupByStage<T extends Ticket>(tickets: readonly T[]): Record<Stage, T[]> {
  const groups = Object.fromEntries(STAGES.map((s) => [s, [] as T[]])) as Record<Stage, T[]>;
  for (const t of tickets) groups[t.stage].push(t);
  for (const s of STAGES) groups[s].sort((a, b) => compareRanks(a.rank, b.rank));
  return groups;
}

/**
 * Moves the domain allows from `stage`, and every stage Andy can force to. Forced
 * includes the allowed ones too, so Andy can e.g. force Backlog → Ready past an unmet DoR.
 * Cancelled is never a move: it has its own action, which stops runs first.
 */
export function moveOptions(stage: Stage): { allowed: Stage[]; forced: Stage[] } {
  return {
    allowed: [...TRANSITIONS[stage]],
    forced: STAGES.filter((s) => s !== stage && s !== "cancelled"),
  };
}

/**
 * What a board drop sends: a normal move when the domain allows `from → to`, else a forced one
 * (Andy only; ADR-0057). `null` when dropped back on its own column, or on Cancelled: cancelling
 * stops runs first, so it is done from the ticket page.
 */
export function dropMove(from: Stage, to: Stage): { to: Stage; force: boolean } | null {
  if (from === to || to === "cancelled") return null;
  return { to, force: !moveOptions(from).allowed.includes(to) };
}

/** Textarea ↔ list: one item per non-blank line. */
export function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** One line describing an event for the history list; `event.body` (comment, reason, answer) is shown below it. */
export function describeEvent(event: TicketEvent): string {
  const d = event.data;
  switch (event.kind) {
    case "created":
      return "created the ticket";
    case "comment":
      return "commented";
    case "stage_changed": {
      const move = `moved ${label(d.from)} → ${label(d.to)}`;
      return d.forced ? `force-${move}` : move;
    }
    case "fields_changed": {
      const fields = d.diff && typeof d.diff === "object" ? Object.keys(d.diff) : [];
      if (fields.length === 1 && fields[0] === "archived") {
        const to = (d.diff as { archived?: { to?: unknown } }).archived?.to;
        return to ? "archived the ticket" : "unarchived the ticket";
      }
      return fields.length ? `changed ${fields.join(", ")}` : "changed fields";
    }
    case "question_asked":
      return "asked a question";
    case "question_answered":
      return "answered a question";
    case "question_withdrawn":
      return "withdrew a question";
    case "run_linked":
      return "linked a run";
    case "pr_linked":
      return typeof d.number === "number" && typeof d.state === "string"
        ? `linked pull request #${d.number} (${d.state})`
        : "linked a pull request";
  }
}

function label(stage: unknown): string {
  return typeof stage === "string" && stage in STAGE_LABELS
    ? STAGE_LABELS[stage as Stage]
    : String(stage);
}

/** One entry in the story panel's activity timeline (ADR-0059). */
export type TimelineItem =
  { kind: "event"; at: string; event: TicketEvent } | { kind: "run"; at: string; run: Run };

/**
 * History events and runs in one list, oldest first. `run_linked` events are dropped: the run
 * shows itself. A run with no timestamp yet goes last.
 */
export function timeline(events: readonly TicketEvent[], runs: readonly Run[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...events
      .filter((e) => e.kind !== "run_linked")
      .map((event) => ({ kind: "event" as const, at: event.createdAt, event })),
    ...runs.map((run) => ({
      kind: "run" as const,
      at: run.createdAt ?? run.startedAt ?? "￿",
      run,
    })),
  ];
  return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
