import { AsyncLocalStorage } from "node:async_hooks";
import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import { MCP_BODY_BYTES } from "./mcp/endpoint";

/**
 * Documents read, per request and per dispatch event (AI-315: Firestore reads still scale with
 * ticket activity). Every store the app reads through is wrapped by `meterReads`; each read adds
 * the documents it returned (at least one: an empty query or a miss still bills a read) to every
 * meter open in its async context. A request logs one line with its route, MCP tool and reads;
 * a dispatch logs its own line too (its reads also count toward the request that caused it). So
 * the next usage alert can be answered from the logs: sum `reads` by `route` or `tool`.
 */

interface Meter {
  reads: number;
}

const open = new AsyncLocalStorage<Meter[]>();

const READ = /^(get|list|count)/;

/** The store with each `get*`, `list*` and `count*` call counted into the open meters. */
export function meterReads<T extends object>(target: T): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value: unknown = Reflect.get(t, prop, receiver);
      if (typeof value !== "function") return value;
      const fn = value as (...args: unknown[]) => unknown;
      if (typeof prop !== "string" || !READ.test(prop)) return fn.bind(t);
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

/** Runs `fn` with a meter of its own (nested inside any open one) and returns its reads. */
export async function measureReads<T>(fn: () => Promise<T>): Promise<{ value: T; reads: number }> {
  const meter: Meter = { reads: 0 };
  const value = await open.run([...(open.getStore() ?? []), meter], fn);
  return { value, reads: meter.reads };
}

/**
 * The MCP tool a `/mcp` request calls, or null (any other method, or a body that isn't JSON).
 * This runs before sign-in and the endpoint's body cap, so it reads only bodies that carry a
 * bearer token and declare a length within that cap: an anonymous or oversized post isn't parsed.
 */
async function toolOf(request: Request): Promise<string | null> {
  const length = Number(request.headers.get("content-length") ?? NaN);
  const bearer = /^Bearer\s/i.test(request.headers.get("authorization") ?? "");
  if (!bearer || !(length > 0 && length <= MCP_BODY_BYTES)) return null;
  try {
    const body = (await request.clone().json()) as {
      method?: unknown;
      params?: { name?: unknown };
    };
    return body.method === "tools/call" && typeof body.params?.name === "string"
      ? body.params.name.slice(0, 100)
      : null;
  } catch {
    return null;
  }
}

/** One INFO line per request that read anything: method, route, MCP tool, status, reads. */
export function readMeterMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const tool = c.req.method === "POST" && c.req.path === "/mcp" ? await toolOf(c.req.raw) : null;
    const { reads } = await measureReads(() => next());
    if (reads === 0) return;
    console.log(
      JSON.stringify({
        severity: "INFO",
        message: "request reads",
        component: "read-meter",
        method: c.req.method,
        // The matched route's pattern (`/api/projects/:projectId/board`), not the raw path.
        route: routePath(c, -1),
        ...(tool ? { tool } : {}),
        status: c.res.status,
        reads,
      }),
    );
  };
}
