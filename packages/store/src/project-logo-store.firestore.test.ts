import { describe, expect, it } from "vitest";
import { FirestoreProjectLogoStore } from "./project-logo-store";
import { createFirestore } from "./index";

// Runs only against the Firestore emulator: `pnpm test:firestore`, locally or in CI's
// `firestore-suite` job (ADR-0048).
const logo = {
  projectId: "ai",
  format: "svg" as const,
  data: '<svg xmlns="http://www.w3.org/2000/svg"/>',
  updatedAt: "2026-11-26T10:00:00.000Z",
  updatedBy: "user:andy",
};

if (process.env.FIRESTORE_EMULATOR_HOST) {
  const db = createFirestore("demo-andy-intelligence");
  const fresh = async () => {
    const existing = await db.collection("projectLogos").get();
    await Promise.all(existing.docs.map((d) => d.ref.delete()));
    return new FirestoreProjectLogoStore(db);
  };

  describe("FirestoreProjectLogoStore", () => {
    it("Given no logo_When get_Then null", async () => {
      expect(await (await fresh()).get("ai")).toBeNull();
    });

    it("Given a stored logo_When put again_Then the new one replaces it", async () => {
      const store = await fresh();
      await store.put(logo);
      await store.put({ ...logo, format: "png", data: "iVBORw0KGgo=" });
      expect(await store.get("ai")).toEqual({ ...logo, format: "png", data: "iVBORw0KGgo=" });
    });

    it("Given a stored logo_When removed_Then get returns null and removing again is fine", async () => {
      const store = await fresh();
      await store.put(logo);
      await store.remove("ai");
      await store.remove("ai");
      expect(await store.get("ai")).toBeNull();
    });
  });
} else {
  describe("FirestoreProjectLogoStore: firestore", () => {
    it.skip("needs the emulator: pnpm test:firestore", () => {});
  });
}
