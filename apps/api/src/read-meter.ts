import { AsyncLocalStorage } from "node:async_hooks";
import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";

/**
 * Documents read, per request and per dispatch event (AI-315: Firestore reads still scale with
 * ticket activity). Each store the app reads through is wrapped by `meterReads` with its list of
 * read methods; each read adds the documents it returned (at least one: an empty query or a miss
 * still bills a read) to every meter open in its async context. A request logs one line with its
 * route, MCP tool and reads; a dispatch logs its own line too (its reads also count toward the
 * request that caused it). So the next usage alert can be answered from the logs: sum `reads` by
 * `route` or `tool`. Reads after the response is returned aren't counted (MCP answers in JSON, not
 * a stream, so its tools finish first). The meter does no work of its own before sign-in.
 */

interface Meter {
  reads: number;
  tool?: string;
}

const open = new AsyncLocalStorage<Meter[]>();

/** `target` with each call to one of `reads` counted into the open meters; others pass through. */
export function meterReads<T extends object>(target: T, reads: readonly (keyof T & string)[]): T {
  const counted = new Set<string | symbol>(reads);
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value: unknown = Reflect.get(t, prop, receiver);
      if (typeof value !== "function") return value;
      const fn = value as (...args: unknown[]) => unknown;
      if (!counted.has(prop)) return fn.bind(t);
      return async (...args: unknown[]) => {
        const result = await fn.apply(t, args);
        const meters = open.getStore();
        if (meters) {
          const docs = Array.isArray(result) ? result.length : 1;
          for (const m of meters) m.reads += Math.max(1, docs);
        }
        return result;
      };
    },
  });
}

function withMeter<T>(meter: Meter, fn: () => Promise<T>): Promise<T> {
  return open.run([...(open.getStore() ?? []), meter], fn);
}

/** Runs `fn` with a meter of its own (nested inside any open one) and returns its reads. */
export async function measureReads<T>(fn: () => Promise<T>): Promise<{ value: T; reads: number }> {
  const meter: Meter = { reads: 0 };
  const value = await withMeter(meter, fn);
  return { value, reads: meter.reads };
}

/** Names the MCP tool the current request runs, for its log line. Called by the tool itself. */
export function noteTool(name: string): void {
  const request = open.getStore()?.[0];
  if (request) request.tool = name.slice(0, 100);
}

/** One INFO line per request that read anything: method, route, MCP tool, status, reads. */
export function readMeterMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const meter: Meter = { reads: 0 };
    await withMeter(meter, () => next());
    if (meter.reads === 0) return;
    console.log(
      JSON.stringify({
        severity: "INFO",
        message: "request reads",
        component: "read-meter",
        method: c.req.method,
        // The matched route's pattern (`/api/projects/:projectId/board`), not the raw path.
        route: routePath(c, -1),
        ...(meter.tool ? { tool: meter.tool } : {}),
        status: c.res.status,
        reads: meter.reads,
      }),
    );
  };
}
