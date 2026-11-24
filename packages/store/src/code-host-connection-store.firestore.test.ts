import { CodeHostConnection } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { GcpCodeHostConnectionStore, type SecretVersions } from "./code-host-connection-store";
import { createFirestore } from "./index";

/** Secret Manager stand-in: the emulator covers Firestore only. */
class MemorySecrets implements SecretVersions {
  private readonly versions = new Map<string, string[]>();
  async latest(id: string) {
    return this.versions.get(id)?.at(-1) ?? null;
  }
  async add(id: string, value: string) {
    this.versions.set(id, [...(this.versions.get(id) ?? []), value]);
  }
}

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048). The only adapter besides the in-memory fake, so its cases
// live here, not in a shared contract suite (AI-360). Each store gets a random document id.
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  const make = () => new GcpCodeHostConnectionStore(db, new MemorySecrets(), crypto.randomUUID());
  const connection = (appId = "123"): CodeHostConnection => ({
    appId,
    slug: "andy-intelligence",
    clientId: "Iv23abc",
    owner: "albernhagen",
    privateKey: "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n",
    webhookSecret: "s3cret",
    connectedAt: "2026-11-03T12:00:00.000Z",
  });

  describe("GcpCodeHostConnectionStore (emulator + in-memory secrets)", () => {
    it("GivenAnEmptyStore_WhenRead_ThenNull", async () => {
      expect(await make().get()).toBeNull();
    });

    it("GivenASavedConnection_WhenRead_ThenItIsReturnedUnchanged", async () => {
      const store = make();
      expect(await store.save(connection())).toBe("saved");
      const read = await store.get();
      expect(read).toEqual(connection());
      expect(CodeHostConnection.parse(read)).toEqual(read);
    });

    it("GivenASavedConnection_WhenSavedAgain_ThenExistsAndTheFirstStays", async () => {
      const store = make();
      await store.save(connection());
      expect(await store.save(connection("999"))).toBe("exists");
      expect((await store.get())?.appId).toBe("123");
    });
  });
} else {
  describe("GcpCodeHostConnectionStore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
