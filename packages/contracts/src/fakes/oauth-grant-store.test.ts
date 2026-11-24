import { describe, expect, it } from "vitest";
import { OAuthGrant } from "../ports";
import { InMemoryOAuthGrantStore } from "./index";

// One adapter besides this fake (Firestore), so no shared contract suite: the adapter's own
// test covers the same cases (AI-360; a shared suite comes with the second adapter).
describe("InMemoryOAuthGrantStore", () => {
  const start = new Date("2026-11-02T12:00:00Z");
  const grant = (expiresAt = "2026-11-02T13:00:00Z"): OAuthGrant => ({
    kind: "code",
    clientId: "https://client.example/metadata.json",
    email: "andy@example.com",
    uid: "u1",
    resource: "https://api.example/mcp",
    scope: "mcp",
    redirectUri: "https://client.example/callback",
    codeChallenge: "challenge",
    expiresAt,
  });
  const make = () => new InMemoryOAuthGrantStore(() => start);

  it("GivenAStoredGrant_WhenRead_ThenItIsReturnedUnchangedAndStaysStored", async () => {
    const store = make();
    await store.put("k", grant());
    const read = await store.get("k");
    expect(read).toEqual(grant());
    expect(OAuthGrant.parse(read)).toEqual(read);
    expect(await store.get("k")).toEqual(grant());
  });

  it("GivenAStoredGrant_WhenTaken_ThenItIsReturnedOnceOnly", async () => {
    const store = make();
    await store.put("k", grant());
    expect(await store.take("k")).toEqual(grant());
    expect(await store.take("k")).toBeNull();
    expect(await store.get("k")).toBeNull();
  });

  it("GivenConcurrentTakes_WhenRacing_ThenExactlyOneWins", async () => {
    const store = make();
    await store.put("k", grant());
    const results = await Promise.all([store.take("k"), store.take("k"), store.take("k")]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("GivenAnExpiredGrant_WhenReadOrTaken_ThenItIsMissing", async () => {
    const store = make();
    await store.put("k", grant("2026-11-02T11:59:59Z"));
    expect(await store.get("k")).toBeNull();
    expect(await store.take("k")).toBeNull();
  });

  it("GivenAnUnknownKey_WhenRead_ThenNull", async () => {
    const store = make();
    expect(await store.get("missing")).toBeNull();
    expect(await store.take("missing")).toBeNull();
  });
});
