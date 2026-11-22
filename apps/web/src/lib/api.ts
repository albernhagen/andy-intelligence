import { createContext, useContext } from "react";
import createClient, { type Client } from "openapi-fetch";
import type { paths } from "./api.gen";

export type Api = Client<paths>;

export interface ApiOptions {
  baseUrl: string;
  /** Returns the signed-in user's ID token, or null when signed out. */
  getToken: () => Promise<string | null>;
  /** Injected in tests to route requests to an in-process API. */
  fetch?: (request: Request) => Promise<Response>;
}

/** Typed client generated from the API's OpenAPI document (ARCHITECTURE §7.5). */
export function createApi({ baseUrl, getToken, fetch }: ApiOptions): Api {
  const client = createClient<paths>({ baseUrl, ...(fetch ? { fetch } : {}) });
  client.use({
    async onRequest({ request }) {
      const token = await getToken();
      if (token) request.headers.set("authorization", `Bearer ${token}`);
      return request;
    },
  });
  return client;
}

export const ApiContext = createContext<Api | null>(null);

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi needs an <ApiContext.Provider>");
  return api;
}

/** Thrown by `unwrap` so TanStack Query surfaces the API's message and details. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: string[] = [],
    /** False when the response carried no message of its own (AI-332); `QueryError` then names what failed. */
    readonly fromApi = true,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/**
 * Returns `data` on success; otherwise throws an ApiError built from the `{ error, details }`
 * body (or `{ message }`). A body with neither (a bare 404, a proxy's page) is marked
 * `fromApi: false`.
 */
export function unwrap<T>({ data, error, response }: FetchResult<T>): T {
  if (data !== undefined && response.ok) return data;
  const body = (error !== null && typeof error === "object" ? error : {}) as {
    error?: unknown;
    message?: unknown;
    details?: unknown;
  };
  const own = [body.error, body.message].find((m) => typeof m === "string" && m.trim() !== "");
  const details = Array.isArray(body.details) ? body.details.map(String) : [];
  if (typeof own === "string") throw new ApiError(response.status, own, details);
  throw new ApiError(response.status, `request failed (${response.status})`, details, false);
}

/** One line for an error banner: "message: detail; detail". */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    return err.details.length ? `${err.message}: ${err.details.join("; ")}` : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
