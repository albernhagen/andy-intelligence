import { describe, expect, it } from "vitest";
import { CodeHostConnection } from "../entities";
import { InMemoryCodeHostConnectionStore } from "./index";

// One adapter besides this fake (GCP), so no shared contract suite: the adapter's own test
// covers the same cases (AI-360; a shared suite comes with the second adapter).
describe("InMemoryCodeHostConnectionStore", () => {
  const connection = (appId = "123"): CodeHostConnection => ({
    appId,
    slug: "andy-intelligence",
    clientId: "Iv23abc",
    owner: "albernhagen",
    privateKey: "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n",
    webhookSecret: "s3cret",
    connectedAt: "2026-11-03T12:00:00.000Z",
  });

  it("GivenAnEmptyStore_WhenRead_ThenNull", async () => {
    expect(await new InMemoryCodeHostConnectionStore().get()).toBeNull();
  });

  it("GivenASavedConnection_WhenRead_ThenItIsReturnedUnchanged", async () => {
    const store = new InMemoryCodeHostConnectionStore();
    expect(await store.save(connection())).toBe("saved");
    const read = await store.get();
    expect(read).toEqual(connection());
    expect(CodeHostConnection.parse(read)).toEqual(read);
  });

  it("GivenASavedConnection_WhenSavedAgain_ThenExistsAndTheFirstStays", async () => {
    const store = new InMemoryCodeHostConnectionStore();
    await store.save(connection());
    expect(await store.save(connection("999"))).toBe("exists");
    expect((await store.get())?.appId).toBe("123");
  });
});
