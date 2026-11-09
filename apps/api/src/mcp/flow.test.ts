import { InMemoryOAuthGrantStore, InMemoryWorkTracker, InMemoryRunStore } from "@andy/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { parseAllowList, type TokenVerifier } from "../auth";
import { ClientMetadataResolver } from "./client-metadata";
import { LOOKUPS_PER_MINUTE } from "./index";
import { hashToken, newToken } from "./tokens";

const PUBLIC_URL = "https://control-plane.example.run.app";
const RESOURCE = `${PUBLIC_URL}/mcp`;
const CLIENT_ID = "https://claude.ai/oauth/mcp-client-metadata";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

// Stub Firebase verifier: the bearer token names the user.
const verifier: TokenVerifier = {
  async verify(token) {
    const users: Record<string, string> = {
      andy: "andy@example.com",
      stranger: "someone@example.com",
    };
    if (!users[token]) throw new Error("bad token");
    return { uid: token, email: users[token], emailVerified: true };
  },
};

function setup(allowList = "andy@example.com") {
  let now = new Date("2026-11-02T12:00:00Z");
  const clock = () => now;
  const grants = new InMemoryOAuthGrantStore(clock);
  const metadataFetch = async (url: string | URL | Request) => {
    expect(String(url)).toBe(CLIENT_ID);
    return Response.json({
      client_id: CLIENT_ID,
      client_name: "Claude",
      redirect_uris: [CALLBACK],
    });
  };
  const allowedEmails = parseAllowList(allowList);
  const app = createApp({
    verifier,
    allowedEmails,
    version: "test",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker: new InMemoryWorkTracker(),
    runs: new InMemoryRunStore(),
    mcp: {
      publicUrl: PUBLIC_URL,
      grants,
      now: clock,
      clients: new ClientMetadataResolver({ fetch: metadataFetch as typeof fetch }),
    },
  });
  // Route every request the MCP client makes (absolute URLs) into the app.
  const appFetch = async (input: string | URL | Request, init?: RequestInit) =>
    app.fetch(input instanceof Request ? input : new Request(input, init));
  return {
    app,
    appFetch,
    grants,
    allowedEmails,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

/** An MCP client provider like Claude's: CIMD client ID, in-memory storage. */
class TestProvider implements OAuthClientProvider {
  clientMetadataUrl = CLIENT_ID;
  authorizationUrl?: URL;
  private verifier = "";
  private saved?: OAuthTokens;
  private info?: OAuthClientInformationMixed;
  get redirectUrl() {
    return CALLBACK;
  }
  get clientMetadata() {
    return { client_name: "Claude", redirect_uris: [CALLBACK] };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.info = info;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: OAuthTokens) {
    this.saved = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
}

/** Plays the browser: follows /oauth/authorize to the consent page and approves as `user`. */
async function approveInBrowser(
  ctx: ReturnType<typeof setup>,
  authorizationUrl: URL,
  user: string,
) {
  const authorize = await ctx.appFetch(authorizationUrl);
  expect(authorize.status).toBe(302);
  const consent = new URL(authorize.headers.get("location")!, PUBLIC_URL);
  expect(consent.pathname).toBe("/oauth/consent");
  expect(consent.searchParams.get("client_name")).toBe("Claude");
  const params = Object.fromEntries(consent.searchParams);
  delete params.client_name;
  return ctx.appFetch(`${PUBLIC_URL}/api/oauth/approve`, {
    method: "POST",
    headers: { authorization: `Bearer ${user}`, "content-type": "application/json" },
    body: JSON.stringify(params),
  });
}

async function connect(ctx: ReturnType<typeof setup>, provider: TestProvider) {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(RESOURCE), {
      authProvider: provider,
      fetch: ctx.appFetch,
    }),
  );
  return client;
}

/** Runs the full authorization: 401 → discovery → authorize → consent → code → tokens. */
async function authorize(ctx: ReturnType<typeof setup>, provider = new TestProvider()) {
  await expect(connect(ctx, provider)).rejects.toThrow(/unauthorized/i);
  expect(provider.authorizationUrl).toBeDefined();
  const approve = await approveInBrowser(ctx, provider.authorizationUrl!, "andy");
  expect(approve.status).toBe(200);
  const redirect = new URL(((await approve.json()) as { redirect: string }).redirect);
  expect(`${redirect.origin}${redirect.pathname}`).toBe(CALLBACK);
  expect(redirect.searchParams.get("iss")).toBe(PUBLIC_URL);
  const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
    authProvider: provider,
    fetch: ctx.appFetch,
  });
  await transport.finishAuth(redirect.searchParams.get("code")!);
  return provider;
}

describe("MCP OAuth flow (MCP SDK client)", () => {
  it("GivenAnAllowListedUser_WhenTheSdkClientAuthorizesViaCimd_ThenStatusAnswers", async () => {
    const ctx = setup();
    const provider = await authorize(ctx);
    expect(provider.clientInformation()).toMatchObject({ client_id: CLIENT_ID });

    const client = await connect(ctx, provider);
    const result = await client.callTool({ name: "status", arguments: {} });
    expect(result.structuredContent).toMatchObject({ signedInAs: "andy@example.com" });
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([
      "answer_question",
      "approve_plan",
      "archive_ticket",
      "build",
      "cancel_ticket",
      "comment_ticket",
      "create_ticket",
      "edit_ticket",
      "list_needs_me",
      "list_ready",
      "move_ticket",
      "promote_assumption",
      "refine",
      "reject_plan",
      "reorder_ticket",
      "set_auto_build",
      "set_auto_merge",
      "set_auto_refine",
      "set_default_worker",
      "set_paused",
      "set_plan_approval",
      "set_runs_at_once",
      "set_ticket_parent",
      "set_worker",
      "status",
    ]);
  });

  it("GivenAUserNotOnTheAllowList_WhenApproving_ThenForbiddenAndNoCodeIssued", async () => {
    const ctx = setup();
    const provider = new TestProvider();
    await expect(connect(ctx, provider)).rejects.toThrow(/unauthorized/i);
    const approve = await approveInBrowser(ctx, provider.authorizationUrl!, "stranger");
    expect(approve.status).toBe(403);
  });

  it("GivenATokenForAUserRemovedFromTheAllowList_WhenCallingMcp_Then401", async () => {
    const ctx = setup();
    const provider = await authorize(ctx);
    (ctx.allowedEmails as Set<string>).clear();
    const res = await ctx.appFetch(RESOURCE, {
      method: "POST",
      headers: {
        authorization: `Bearer ${provider.tokens()!.access_token}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("GivenAnExpiredAccessToken_WhenTheClientRefreshes_ThenTheRefreshTokenRotates", async () => {
    const ctx = setup();
    const provider = await authorize(ctx);
    const first = provider.tokens()!;
    ctx.advance(61 * 60 * 1000);

    const client = await connect(ctx, provider);
    await client.callTool({ name: "status", arguments: {} });
    const second = provider.tokens()!;
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(await ctx.grants.get(hashToken(first.refresh_token!))).toBeNull();

    // The used refresh token is dead: replaying it fails.
    const replay = await ctx.appFetch(`${PUBLIC_URL}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: first.refresh_token!,
        client_id: CLIENT_ID,
      }),
    });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
  });
});

describe("MCP OAuth refresh checks", () => {
  const refresh = (ctx: ReturnType<typeof setup>, token: string, clientId = CLIENT_ID) =>
    ctx.appFetch(`${PUBLIC_URL}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token,
        client_id: clientId,
      }),
    });

  it("GivenAUserRemovedFromTheAllowList_WhenRefreshing_ThenInvalidGrant", async () => {
    const ctx = setup();
    const provider = await authorize(ctx);
    (ctx.allowedEmails as Set<string>).clear();
    const res = await refresh(ctx, provider.tokens()!.refresh_token!);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("GivenARefreshTokenFromAnotherClient_WhenRefreshing_ThenInvalidGrant", async () => {
    const ctx = setup();
    const provider = await authorize(ctx);
    const res = await refresh(
      ctx,
      provider.tokens()!.refresh_token!,
      "https://claude.ai/other-client",
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_grant" });
  });
});

describe("MCP lookup cap (ADR-0028)", () => {
  const callMcp = (ctx: ReturnType<typeof setup>, token: string) =>
    ctx.appFetch(RESOURCE, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: "{}",
    });

  it("GivenManyRandomTokens_WhenCallingMcp_ThenLookupsStopAtTheCapWith429", async () => {
    const ctx = setup();
    for (let i = 0; i < LOOKUPS_PER_MINUTE; i++)
      expect((await callMcp(ctx, newToken())).status).toBe(401);
    const res = await callMcp(ctx, newToken());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("GivenMalformedTokens_WhenCallingMcpOrTheTokenEndpoint_ThenNoLookupIsSpent", async () => {
    const ctx = setup();
    for (let i = 0; i < LOOKUPS_PER_MINUTE + 5; i++)
      expect((await callMcp(ctx, "garbage")).status).toBe(401);
    const res = await ctx.appFetch(`${PUBLIC_URL}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: "short",
        client_id: CLIENT_ID,
      }),
    });
    expect(await res.json()).toMatchObject({ error: "invalid_grant" });
    // The cap is untouched, so a real token-shaped lookup still runs (and misses).
    expect((await callMcp(ctx, newToken())).status).toBe(401);
  });
});

describe("MCP OAuth endpoints", () => {
  const form = (fields: Record<string, string>) => ({
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });

  it("GivenNoToken_WhenCallingMcp_Then401PointsAtTheResourceMetadata", async () => {
    const { appFetch } = setup();
    const res = await appFetch(RESOURCE, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource/mcp"`,
    );
    const garbage = await appFetch(RESOURCE, {
      method: "POST",
      headers: { authorization: "Bearer nope" },
      body: "{}",
    });
    expect(garbage.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("GivenDiscovery_WhenFetchingMetadata_ThenItAdvertisesCimdPkceAndTheExactResource", async () => {
    const { appFetch } = setup();
    const prm = await (
      await appFetch(`${PUBLIC_URL}/.well-known/oauth-protected-resource/mcp`)
    ).json();
    expect(prm).toMatchObject({ resource: RESOURCE, authorization_servers: [PUBLIC_URL] });
    const asm = await (
      await appFetch(`${PUBLIC_URL}/.well-known/oauth-authorization-server`)
    ).json();
    expect(asm).toMatchObject({
      issuer: PUBLIC_URL,
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
    });
    expect(asm).not.toHaveProperty("registration_endpoint");
  });

  it("GivenABadAuthorizeRequest_WhenSent_ThenItIsShownAs400AndNotRedirected", async () => {
    const { appFetch } = setup();
    const base = {
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: CALLBACK,
      code_challenge: "x".repeat(43),
      code_challenge_method: "S256",
    };
    const cases: [Record<string, string>, string][] = [
      [{ ...base, redirect_uri: "https://evil.example/cb" }, "invalid_request"],
      [{ ...base, client_id: "https://evil.example/client" }, "invalid_client"],
      [{ ...base, code_challenge_method: "plain" }, "invalid_request"],
      [{ ...base, resource: "https://other.example/mcp" }, "invalid_target"],
      [{ ...base, scope: "admin" }, "invalid_scope"],
    ];
    for (const [params, error] of cases) {
      const res = await appFetch(`${PUBLIC_URL}/oauth/authorize?${new URLSearchParams(params)}`);
      expect([400, 401]).toContain(res.status);
      expect(res.headers.get("location")).toBeNull();
      expect(await res.json()).toMatchObject({ error });
    }
  });

  it("GivenApproveWithoutAFirebaseToken_WhenPosted_Then401", async () => {
    const { appFetch } = setup();
    const res = await appFetch(`${PUBLIC_URL}/api/oauth/approve`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("GivenACode_WhenExchangedWithAWrongVerifierOrTwice_ThenInvalidGrant", async () => {
    const ctx = setup();
    const provider = new TestProvider();
    await expect(connect(ctx, provider)).rejects.toThrow(/unauthorized/i);
    const approve = await approveInBrowser(ctx, provider.authorizationUrl!, "andy");
    const code = new URL(
      ((await approve.json()) as { redirect: string }).redirect,
    ).searchParams.get("code")!;
    const exchange = (verifier: string) =>
      ctx.appFetch(
        `${PUBLIC_URL}/oauth/token`,
        form({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          redirect_uri: CALLBACK,
          client_id: CLIENT_ID,
        }),
      );
    // A wrong verifier burns the code, so even the right one fails afterwards.
    expect(await (await exchange("w".repeat(43))).json()).toMatchObject({ error: "invalid_grant" });
    expect(await (await exchange(provider.codeVerifier())).json()).toMatchObject({
      error: "invalid_grant",
    });
  });

  it("GivenAnExpiredCode_WhenExchanged_ThenInvalidGrant", async () => {
    const ctx = setup();
    const provider = new TestProvider();
    await expect(connect(ctx, provider)).rejects.toThrow(/unauthorized/i);
    const approve = await approveInBrowser(ctx, provider.authorizationUrl!, "andy");
    const code = new URL(
      ((await approve.json()) as { redirect: string }).redirect,
    ).searchParams.get("code")!;
    ctx.advance(61 * 1000);
    const res = await ctx.appFetch(
      `${PUBLIC_URL}/oauth/token`,
      form({
        grant_type: "authorization_code",
        code,
        code_verifier: provider.codeVerifier(),
        redirect_uri: CALLBACK,
        client_id: CLIENT_ID,
      }),
    );
    expect(await res.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("GivenAnUnknownGrantType_WhenPosted_ThenUnsupportedGrantType", async () => {
    const { appFetch } = setup();
    const res = await appFetch(
      `${PUBLIC_URL}/oauth/token`,
      form({ grant_type: "client_credentials", client_id: CLIENT_ID }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "unsupported_grant_type" });
  });

  it("GivenAnyResponse_WhenServed_ThenFramingIsDenied", async () => {
    const { appFetch } = setup();
    const res = await appFetch(`${PUBLIC_URL}/health`);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("MCP off", () => {
  it("GivenNoPublicUrl_WhenCallingMcpRoutes_ThenTheyDoNotExist", async () => {
    const app = createApp({
      verifier,
      allowedEmails: parseAllowList("andy@example.com"),
      version: "test",
      webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
      tracker: new InMemoryWorkTracker(),
      runs: new InMemoryRunStore(),
    });
    expect((await app.request("/mcp", { method: "POST" })).status).toBe(404);
    expect((await app.request("/.well-known/oauth-authorization-server")).status).toBe(404);
  });
});
