/**
 * The command palette's search (AI-370): plain substring matching over a few hundred tickets and a
 * short list of commands, so no fuzzy-search dependency.
 */

export type PaletteGroup = "Tickets" | "Actions" | "Go to" | "Projects";

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  /** Muted text after the label: a ticket's project and stage, what an action does. */
  hint?: string;
  /** Keys shown on the right, e.g. ["G", "R"]. */
  keys?: string[];
  /** Extra words that match but aren't shown. */
  keywords?: string;
  run: () => void;
}

export interface PaletteTicket {
  projectId: string;
  projectName: string;
  key: string;
  title: string;
  stage: string;
}

export const MAX_TICKETS = 8;

const words = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/** True when every word of the query is in the item's label, hint or keywords. */
export function matchesQuery(item: PaletteItem, query: string): boolean {
  const haystack = `${item.label} ${item.hint ?? ""} ${item.keywords ?? ""}`.toLowerCase();
  return words(query).every((w) => haystack.includes(w));
}

/**
 * Tickets for a query: an exact key first, then keys starting with it, then titles holding every
 * word. Nothing for an empty query: the palette opens on its commands.
 */
export function searchTickets(
  tickets: readonly PaletteTicket[],
  query: string,
  limit = MAX_TICKETS,
): PaletteTicket[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rank = (t: PaletteTicket): number => {
    const key = t.key.toLowerCase();
    if (key === q) return 0;
    if (key.startsWith(q)) return 1;
    const title = t.title.toLowerCase();
    return words(q).every((w) => title.includes(w) || key.includes(w)) ? 2 : -1;
  };
  return tickets
    .map((t) => ({ t, r: rank(t) }))
    .filter(({ r }) => r >= 0)
    .sort((a, b) => a.r - b.r || a.t.key.localeCompare(b.t.key, "en", { numeric: true }))
    .slice(0, limit)
    .map(({ t }) => t);
}

/** "g r" → ["G", "R"]; "?" stays "?". */
export const keyCaps = (keys: string) => keys.split(" ").map((k) => k.toUpperCase());
