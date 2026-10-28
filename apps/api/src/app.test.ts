import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { parseAllowList, type TokenVerifier } from "./auth";

const verifier: TokenVerifier = {
  async verify(token) {
    const users: Record<string, { email: string; emailVerified: boolean }> = {
      andy: { email: "Andy@Example.com", emailVerified: true },
      stranger: { email: "someone@example.com", emailVerified: true },
      unverified: { email: "andy@example.com", emailVerified: false },
    };
    const u = users[token];
    if (!u) throw new Error("bad token");
    return { uid: token, ...u };
  },
};

const app = createApp({
  verifier,
  allowedEmails: parseAllowList(" andy@example.com "),
  version: "test",
  webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
});

const get = (path: string, token?: string) =>
  app.request(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe("api", () => {
  it("health is public", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version: "test" });
  });

  it("rejects missing and invalid tokens with 401", async () => {
    expect((await get("/api/me")).status).toBe(401);
    expect((await get("/api/me", "garbage")).status).toBe(401);
  });

  it("rejects users not on the allow-list or unverified with 403", async () => {
    expect((await get("/api/me", "stranger")).status).toBe(403);
    expect((await get("/api/me", "unverified")).status).toBe(403);
  });

  it("allows the allow-listed user (case-insensitive)", async () => {
    const res = await get("/api/me", "andy");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "Andy@Example.com", uid: "andy" });
  });

  it("publishes an OpenAPI document", async () => {
    const res = await get("/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/health", "/api/me"]));
  });
});
