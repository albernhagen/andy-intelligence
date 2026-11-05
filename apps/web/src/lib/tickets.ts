import { Stage, type Question, type Ticket, type TicketEvent } from "@andy/contracts";
import { ARCHIVABLE_STAGES, TRANSITIONS } from "@andy/domain";

/** Board columns, in workflow order (ARCHITECTURE §4.1). */
export const STAGES: readonly Stage[] = Stage.options;

export const STAGE_LABELS: Record<Stage, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In progress",
  ready_for_review: "Ready for review",
  monitoring: "Monitoring",
  done: "Done",
  cancelled: "Cancelled",
};

/** The board hides archived tickets unless Andy asks for them (AI-15: Cancel and archive tickets). */
export function visibleTickets(tickets: readonly Ticket[], showArchived: boolean): Ticket[] {
  return showArchived ? [...tickets] : tickets.filter((t) => !t.archived);
}

/** Whether the ticket can be archived now: only Done or Cancelled tickets. */
export function canArchive(ticket: Pick<Ticket, "stage">): boolean {
  return ARCHIVABLE_STAGES.includes(ticket.stage);
}

/** Groups tickets into every stage column (empty ones included), each sorted by rank. */
export function groupByStage(tickets: readonly Ticket[]): Record<Stage, Ticket[]> {
  const groups = Object.fromEntries(STAGES.map((s) => [s, [] as Ticket[]])) as Record<
    Stage,
    Ticket[]
  >;
  for (const t of tickets) groups[t.stage].push(t);
  for (const s of STAGES)
    groups[s].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  return groups;
}

/**
 * Moves the domain allows from `stage`, and every stage Andy can force to with a reason. Forced
 * includes the allowed ones too, so Andy can e.g. force Backlog → Ready past an unmet DoR.
 * Cancelled is never a move: it has its own action, which stops runs first.
 */
export function moveOptions(stage: Stage): { allowed: Stage[]; forced: Stage[] } {
  return {
    allowed: [...TRANSITIONS[stage]],
    forced: STAGES.filter((s) => s !== stage && s !== "cancelled"),
  };
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

/** Inbox order: high urgency first, then oldest first. */
export function sortQuestions(questions: readonly Question[]): Question[] {
  const weight = { high: 0, normal: 1, low: 2 } as const;
  return [...questions].sort(
    (a, b) => weight[a.urgency] - weight[b.urgency] || a.createdAt.localeCompare(b.createdAt),
  );
}
