import { z } from "zod";
import { OAuthError } from "./errors";

/** Hosts whose client ID metadata documents we accept: Claude's (ADR-0039: MCP OAuth facade). */
export const CLAUDE_CLIENT_HOSTS = ["claude.ai", "claude.com"];

const MAX_BYTES = 16 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 20;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

const MetadataDocument = z.object({
  client_id: z.string(),
  client_name: z.string().max(200).optional(),
  redirect_uris: z.array(z.string().max(2000)).min(1).max(20),
});

export interface ClientMetadataOptions {
  allowedHosts?: readonly string[];
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * Resolves OAuth clients from Client ID Metadata Documents (CIMD): the client_id is an
 * HTTPS URL and the document at that URL lists the client's redirect URIs. We fetch only
 * from allow-listed hosts, so /oauth/authorize can't be used to make us fetch arbitrary
 * URLs (SSRF). Successful lookups are cached; the cache is capped.
 */
export class ClientMetadataResolver {
  private readonly allowedHosts: ReadonlySet<string>;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly cache = new Map<string, { client: OAuthClient; expires: number }>();

  constructor(opts: ClientMetadataOptions = {}) {
    this.allowedHosts = new Set(opts.allowedHosts ?? CLAUDE_CLIENT_HOSTS);
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.now = opts.now ?? Date.now;
  }

  async resolve(clientId: string): Promise<OAuthClient> {
    const cached = this.cache.get(clientId);
    if (cached && cached.expires > this.now()) return cached.client;

    const url = this.checkClientId(clientId);
    const client = await this.load(url, clientId);
    this.cache.delete(clientId);
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(clientId, { client, expires: this.now() + CACHE_TTL_MS });
    return client;
  }

  private checkClientId(clientId: string): URL {
    let url: URL;
    try {
      url = new URL(clientId);
    } catch {
      throw new OAuthError("invalid_client", "client_id must be a metadata document URL");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.port ||
      url.pathname === "/" ||
      !this.allowedHosts.has(url.hostname)
    ) {
      throw new OAuthError("invalid_client", "client_id is not an allowed metadata document URL");
    }
    return url;
  }

  private async load(url: URL, clientId: string): Promise<OAuthClient> {
    let text: string;
    try {
      const res = await this.fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      text = await readCapped(res, MAX_BYTES);
    } catch (err) {
      throw new OAuthError("invalid_client", `client metadata fetch failed: ${String(err)}`);
    }

    let doc: z.infer<typeof MetadataDocument>;
    try {
      doc = MetadataDocument.parse(JSON.parse(text));
    } catch {
      throw new OAuthError("invalid_client", "client metadata document is malformed");
    }
    if (doc.client_id !== clientId) {
      throw new OAuthError("invalid_client", "client metadata client_id does not match its URL");
    }
    return {
      clientId,
      clientName: doc.client_name ?? new URL(clientId).hostname,
      redirectUris: doc.redirect_uris.filter(isAcceptableRedirect),
    };
  }
}

/**
 * Exact match, except loopback redirects (Claude Code) where the port is ignored, as
 * Claude's connector docs ask.
 */
export function redirectUriAllowed(client: OAuthClient, redirectUri: string): boolean {
  if (client.redirectUris.includes(redirectUri)) return true;
  const wanted = parseLoopback(redirectUri);
  if (!wanted) return false;
  return client.redirectUris.some((r) => {
    const registered = parseLoopback(r);
    return (
      !!registered &&
      registered.hostname === wanted.hostname &&
      registered.pathname === wanted.pathname &&
      registered.search === wanted.search
    );
  });
}

function isAcceptableRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    return !url.hash && (url.protocol === "https:" || !!parseLoopback(uri));
  } catch {
    return false;
  }
}

function parseLoopback(uri: string): URL | null {
  try {
    const url = new URL(uri);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) && !url.hash ? url : null;
  } catch {
    return null;
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("document too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
