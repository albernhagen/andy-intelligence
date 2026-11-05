import type { Ticket } from "@andy/contracts";

export type DorInput = Pick<Ticket, "type" | "body" | "acceptanceCriteria" | "size" | "sizeReason">;

export interface DorResult {
  met: boolean;
  /** Human-readable gaps, empty when met. */
  missing: string[];
}

/** EARS form, any subject (ADR-0058): "WHEN … the API shall …", "IF … THEN the system shall …". */
const EARS = /\S\s+shall\s+\S/i;

/**
 * Definition of Ready (ARCHITECTURE §4.2, per type from ADR-0058: Ticket model). Every type
 * needs an intent and no open questions; an epic needs nothing else. Features, bugs and chores
 * also need a size with its reason; then:
 * - feature: at least one criterion, each in EARS form;
 * - bug: at least one criterion stating the expected behaviour (any wording);
 * - chore: a "done when" checklist (any wording).
 * A ticket with no type yet gets the shared checks plus "type". Tier is not checked: it is
 * derived from size (`tierFor`). Dependencies and assumptions can't be checked mechanically;
 * refinement owns them.
 */
export function checkDor(ticket: DorInput, openQuestions: number): DorResult {
  const missing: string[] = [];
  if (ticket.type === null) missing.push("type");
  if (ticket.body.trim() === "") {
    missing.push(
      ticket.type === "bug"
        ? "steps to reproduce and actual behaviour in the body"
        : "problem/intent in the body",
    );
  }
  if (openQuestions > 0) missing.push(`${openQuestions} open question(s) answered`);
  if (ticket.type === "epic") return result(missing);

  const criteria = ticket.acceptanceCriteria.filter((c) => c.trim() !== "");
  if (ticket.type === "feature") {
    if (criteria.length === 0) missing.push("acceptance criteria");
    const notEars = criteria.filter((c) => !EARS.test(c)).length;
    if (notEars > 0) {
      missing.push(`${notEars} acceptance criterion/criteria in EARS form ("… shall …")`);
    }
  }
  if (ticket.type === "bug" && criteria.length === 0) {
    missing.push("expected behaviour as an acceptance criterion");
  }
  if (ticket.type === "chore" && criteria.length === 0) missing.push('"done when" checklist');
  if (ticket.size === null) missing.push("size");
  if (!ticket.sizeReason?.trim()) missing.push("size justification");
  return result(missing);
}

function result(missing: string[]): DorResult {
  return { met: missing.length === 0, missing };
}
