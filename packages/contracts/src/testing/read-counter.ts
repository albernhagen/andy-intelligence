/**
 * Test helper (AI-222: Firestore reads grow with project size): wraps a store so tests can count
 * the documents its reads return, as Firestore bills them. A `get*`, `list*` or `count*` call
 * costs one read per document it returns, and at least one (an empty query or a miss still
 * bills a read). Writes pass through uncounted. `returned` keeps every document read, so a test
 * can check, say, that no archived ticket was read.
 */
export interface ReadCounter<T> {
  store: T;
  reads(): number;
  returned(): unknown[];
  reset(): void;
}

const READ = /^(get|list|count)/;

export function countReads<T extends object>(target: T): ReadCounter<T> {
  let reads = 0;
  let returned: unknown[] = [];
  const store = new Proxy(target, {
    get(t, prop, receiver) {
      const value: unknown = Reflect.get(t, prop, receiver);
      if (typeof value !== "function") return value;
      const fn = value as (...args: unknown[]) => unknown;
      if (typeof prop !== "string" || !READ.test(prop)) return fn.bind(t);
      return async (...args: unknown[]) => {
        const result = await fn.apply(t, args);
        const docs = Array.isArray(result) ? result : result == null ? [] : [result];
        reads += Math.max(1, docs.length);
        returned.push(...docs);
        return result;
      };
    },
  });
  return {
    store,
    reads: () => reads,
    returned: () => returned,
    reset: () => {
      reads = 0;
      returned = [];
    },
  };
}
