/**
 * One page of a list a route returns whole (AI-293): MCP answers stay capped (ADR-0028) while
 * the pages, read in order, add up to exactly the route's list.
 */

/** Most items one MCP page carries, and the page size when the caller names none. */
export const PAGE_MAX = 200;
export const PAGE_DEFAULT = 50;

export interface Page<T> {
  /** How many items the whole list has. */
  total: number;
  offset: number;
  items: T[];
  /** The `offset` of the next page; null on the last one. */
  nextOffset: number | null;
}

export function pageOf<T>(items: readonly T[], offset = 0, limit = PAGE_DEFAULT): Page<T> {
  const size = Math.min(Math.max(1, limit), PAGE_MAX);
  const start = Math.max(0, offset);
  const end = start + size;
  return {
    total: items.length,
    offset: start,
    items: items.slice(start, end),
    nextOffset: end < items.length ? end : null,
  };
}
