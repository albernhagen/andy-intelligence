/** Items on 1-based page `page` of `size` items. */
export function pageOf<T>(items: T[], page: number, size: number): T[] {
  const start = (page - 1) * size;
  return items.slice(start, start + size + 1);
}
