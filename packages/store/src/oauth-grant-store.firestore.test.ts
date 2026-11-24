import { OAuthGrant } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { createFirestore } from "./index";
import { FirestoreOAuthGrantStore } from "./oauth-grant-store";

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048). The only adapter besides the in-memory fake, so its cases
// live here, not in a shared contract suite (AI-360). Keys are random: the emulator is shared.
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  const start = new Date("2026-11-02T12:00:00Z");
  const make = () => new FirestoreOAuthGrantStore(db, () => start);
  const key = () => crypto.randomUUID();
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

  describe("FirestoreOAuthGrantStore (emulator)", () => {
    it("GivenAStoredGrant_WhenRead_ThenItIsReturnedUnchangedAndStaysStored", async () => {
      const store = make();
      const k = key();
      await store.put(k, grant());
      const read = await store.get(k);
      expect(read).toEqual(grant());
      expect(OAuthGrant.parse(read)).toEqual(read);
      expect(await store.get(k)).toEqual(grant());
    });

    it("GivenAStoredGrant_WhenTaken_ThenItIsReturnedOnceOnly", async () => {
      const store = make();
      const k = key();
      await store.put(k, grant());
      expect(await store.take(k)).toEqual(grant());
      expect(await store.take(k)).toBeNull();
      expect(await store.get(k)).toBeNull();
    });

    // Three transactions take one grant: the emulator's lock wait plus client backoff (AI-71).
    it("GivenConcurrentTakes_WhenRacing_ThenExactlyOneWins", async () => {
      const store = make();
      const k = key();
      await store.put(k, grant());
      const results = await Promise.all([store.take(k), store.take(k), store.take(k)]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
    }, 30_000);

    it("GivenAnExpiredGrant_WhenReadOrTaken_ThenItIsMissing", async () => {
      const store = make();
      const k = key();
      await store.put(k, grant("2026-11-02T11:59:59Z"));
      expect(await store.get(k)).toBeNull();
      expect(await store.take(k)).toBeNull();
    });

    it("GivenAnUnknownKey_WhenRead_ThenNull", async () => {
      const store = make();
      expect(await store.get(key())).toBeNull();
      expect(await store.take(key())).toBeNull();
    });
  });
} else {
  describe("FirestoreOAuthGrantStore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
