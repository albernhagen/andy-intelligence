import type { Ticket, TicketOverrides } from "@andy/contracts";

/**
 * Override precedence (AI-116, domain-and-ports "Override precedence"): ticket, then its epic,
 * then project policy. Resolved on read, never copied onto the child, so changing an epic's
 * override applies to every child without its own value.
 */

/** The fields an epic passes down. `executor` doesn't cascade: it follows the project (ADR-0089). */
export const CASCADED_OVERRIDES = [
  "assignee",
  "tier",
  "modelPin",
  "autonomy",
  "targetEnv",
] as const satisfies readonly (keyof TicketOverrides)[];
export type CascadedOverride = (typeof CASCADED_OVERRIDES)[number];

type WithOverrides = Pick<Ticket, "overrides">;

/** Each cascaded field from the ticket if set, else from its epic; the rest from the ticket. */
export function effectiveOverrides(
  ticket: WithOverrides,
  epic: WithOverrides | null | undefined,
): TicketOverrides {
  if (!epic) return ticket.overrides;
  const merged: TicketOverrides = { ...ticket.overrides };
  for (const field of CASCADED_OVERRIDES) {
    if (merged[field] === undefined && epic.overrides[field] !== undefined) {
      Object.assign(merged, { [field]: epic.overrides[field] });
    }
  }
  return merged;
}

/** The cascaded fields the ticket takes from its epic, not its own. */
export function inheritedOverrides(
  ticket: WithOverrides,
  epic: WithOverrides | null | undefined,
): CascadedOverride[] {
  if (!epic) return [];
  return CASCADED_OVERRIDES.filter(
    (f) => ticket.overrides[f] === undefined && epic.overrides[f] !== undefined,
  );
}

/** The ticket's epic among `tickets`: its parent, when that is an epic. */
export function epicOf<T extends Pick<Ticket, "id" | "type">>(
  ticket: Pick<Ticket, "parentId">,
  tickets: readonly T[],
): T | null {
  if (!ticket.parentId) return null;
  const parent = tickets.find((t) => t.id === ticket.parentId);
  return parent?.type === "epic" ? parent : null;
}
