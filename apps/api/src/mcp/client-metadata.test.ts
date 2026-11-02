import { describe, expect, it, vi } from "vitest";
import { ClientMetadataResolver, redirectUriAllowed } from "./client-metadata";

const CLIENT_ID = "https://claude.ai/oauth/mcp-client-metadata";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

function fetchReturning(body: unknown, status = 200) {
  return vi.fn(
    async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
}

const doc = {
  client_id: CLIENT_ID,
  client_name: "Claude",
  redirect_uris: [CALLBACK, "http://localhost/callback", "javascript:alert(1)"],
};

describe("ClientMetadataResolver", () => {
  it("GivenAClaudeMetadataDocument_WhenResolved_ThenTheClientHasItsSafeRedirectUris", async () => {
    const resolver = new ClientMetadataResolver({ fetch: fetchReturning(doc) });
    expect(await resolver.resolve(CLIENT_ID)).toEqual({
      clientId: CLIENT_ID,
      clientName: "Claude",
      redirectUris: [CALLBACK, "http://localhost/callback"],
    });
  });

  it.each([
    ["not a URL", "claude"],
    ["another host", "https://evil.example/metadata"],
    ["a lookalike host", "https://claude.ai.evil.example/metadata"],
    ["plain http", "http://claude.ai/metadata"],
    ["a root path", "https://claude.ai/"],
    ["a port", "https://claude.ai:8443/metadata"],
    ["credentials", "https://user:pw@claude.ai/metadata"],
  ])("GivenAClientIdWith%s_WhenResolved_ThenInvalidClientWithoutFetching", async (_, clientId) => {
    const fetch = fetchReturning(doc);
    const resolver = new ClientMetadataResolver({ fetch });
    await expect(resolver.resolve(clientId)).rejects.toMatchObject({ code: "invalid_client" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("GivenADocumentForAnotherClientId_WhenResolved_ThenInvalidClient", async () => {
    const resolver = new ClientMetadataResolver({
      fetch: fetchReturning({ ...doc, client_id: "https://claude.ai/other" }),
    });
    await expect(resolver.resolve(CLIENT_ID)).rejects.toMatchObject({ code: "invalid_client" });
  });

  it("GivenAnOversizedOrBrokenDocument_WhenResolved_ThenInvalidClient", async () => {
    const big = new ClientMetadataResolver({ fetch: fetchReturning("x".repeat(17 * 1024)) });
    await expect(big.resolve(CLIENT_ID)).rejects.toMatchObject({ code: "invalid_client" });
    const notFound = new ClientMetadataResolver({ fetch: fetchReturning(doc, 404) });
    await expect(notFound.resolve(CLIENT_ID)).rejects.toMatchObject({ code: "invalid_client" });
    const notJson = new ClientMetadataResolver({ fetch: fetchReturning("<html>") });
    await expect(notJson.resolve(CLIENT_ID)).rejects.toMatchObject({ code: "invalid_client" });
  });

  it("GivenAResolvedClient_WhenResolvedAgainWithinAnHour_ThenTheCacheAnswers", async () => {
    let now = 0;
    const fetch = fetchReturning(doc);
    const resolver = new ClientMetadataResolver({ fetch, now: () => now });
    await resolver.resolve(CLIENT_ID);
    await resolver.resolve(CLIENT_ID);
    expect(fetch).toHaveBeenCalledTimes(1);
    now = 60 * 60 * 1000 + 1;
    await resolver.resolve(CLIENT_ID);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("redirectUriAllowed", () => {
  const client = {
    clientId: CLIENT_ID,
    clientName: "Claude",
    redirectUris: [CALLBACK, "http://localhost/callback"],
  };

  it("GivenARegisteredHttpsUri_WhenChecked_ThenOnlyAnExactMatchIsAllowed", () => {
    expect(redirectUriAllowed(client, CALLBACK)).toBe(true);
    expect(redirectUriAllowed(client, `${CALLBACK}?x=1`)).toBe(false);
    expect(redirectUriAllowed(client, "https://evil.example/api/mcp/auth_callback")).toBe(false);
  });

  it("GivenALoopbackUri_WhenChecked_ThenAnyPortMatchesButHostAndPathMustMatch", () => {
    expect(redirectUriAllowed(client, "http://localhost:3118/callback")).toBe(true);
    expect(redirectUriAllowed(client, "http://localhost:3118/other")).toBe(false);
    expect(redirectUriAllowed(client, "http://127.0.0.1:3118/callback")).toBe(false);
  });
});
