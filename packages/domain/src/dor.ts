import type { Ticket } from "@andy/contracts";

export type DorInput = Pick<
  Ticket,
  "type" | "body" | "acceptanceCriteria" | "size" | "sizeReason" | "tier"
>;

export interface DorResult {
  met: boolean;
  /** Human-readable gaps, empty when met. */
  missing: string[];
}

/** Every EARS pattern ("WHEN … THE SYSTEM SHALL …", "WHILE …", "IF … THEN …") contains this. */
const EARS = /\bTHE SYSTEM SHALL\b/i;

/**
 * Definition of Ready (ARCHITECTURE §4.2). Epics need only an intent and no open questions;
 * stories, tasks and bugs also need EARS acceptance criteria, a justified size and a tier.
 * Dependencies and assumptions can't be checked mechanically; refinement owns them.
 */
export function checkDor(ticket: DorInput, openQuestions: number): DorResult {
  const missing: string[] = [];
  if (ticket.body.trim() === "") missing.push("problem/intent in the body");
  if (openQuestions > 0) missing.push(`${openQuestions} open question(s) answered`);
  if (ticket.type !== "epic") {
    if (ticket.acceptanceCriteria.length === 0) missing.push("acceptance criteria");
    const notEars = ticket.acceptanceCriteria.filter((c) => !EARS.test(c)).length;
    if (notEars > 0) missing.push(`${notEars} acceptance criterion/criteria in EARS form`);
    if (ticket.size === null) missing.push("size");
    if (!ticket.sizeReason?.trim()) missing.push("size justification");
    if (ticket.tier === null) missing.push("tier");
  }
  return { met: missing.length === 0, missing };
}
