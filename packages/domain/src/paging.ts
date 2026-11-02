/** Items on 1-based page `page` of `size` items; empty for pages out of range or bad sizes. */
export function pageOf<T>(items: T[], page: number, size: number): T[] {
  if (!Number.isInteger(page) || !Number.isInteger(size) || page < 1 || size < 1) return [];
  const start = (page - 1) * size;
  if (page > 3) return items.slice(start - 1, start + size - 1);
  return items.slice(start, start + size);
}
