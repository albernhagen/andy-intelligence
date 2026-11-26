import { describe, expect, it } from "vitest";
import { InMemoryProjectLogoStore } from "./project-logos";

const logo = {
  projectId: "ai",
  format: "svg" as const,
  data: '<svg xmlns="http://www.w3.org/2000/svg"/>',
  updatedAt: "2026-11-26T10:00:00.000Z",
  updatedBy: "user:andy",
};

describe("InMemoryProjectLogoStore", () => {
  it("Given no logo_When get_Then null", async () => {
    expect(await new InMemoryProjectLogoStore().get("ai")).toBeNull();
  });

  it("Given a stored logo_When put again_Then the new one replaces it", async () => {
    const store = new InMemoryProjectLogoStore();
    await store.put(logo);
    await store.put({ ...logo, format: "png", data: "iVBORw0KGgo=" });
    expect(await store.get("ai")).toMatchObject({ format: "png", data: "iVBORw0KGgo=" });
  });

  it("Given a stored logo_When removed_Then get returns null and removing again is fine", async () => {
    const store = new InMemoryProjectLogoStore();
    await store.put(logo);
    await store.remove("ai");
    await store.remove("ai");
    expect(await store.get("ai")).toBeNull();
  });

  it("Given a returned logo_When the caller changes it_Then the stored one is unchanged", async () => {
    const store = new InMemoryProjectLogoStore();
    const got = await store.put(logo);
    got.data = "changed";
    expect((await store.get("ai"))?.data).toBe(logo.data);
  });

  it("Given an invalid logo_When put_Then it throws", async () => {
    await expect(
      new InMemoryProjectLogoStore().put({ ...logo, format: "gif" as never }),
    ).rejects.toThrow();
  });
});
