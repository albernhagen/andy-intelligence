import { describe, expect, it } from "vitest";
import {
  MEMBERSHIPS_MAX,
  MEMBERS_PER_PROJECT_MAX,
  type Membership,
  type MembershipInput,
} from "../entities/membership";
import type { MembershipStore } from "../ports/membership";

export const membership = (over: Partial<MembershipInput> = {}): MembershipInput => ({
  projectId: "p1",
  email: "member@example.com",
  role: "contributor",
  uid: null,
  displayName: null,
  addedBy: "andy",
  addedAt: "2026-11-21T12:00:00.000Z",
  ...over,
});

const emailN = (n: number) => `member${String(n).padStart(3, "0")}@example.com`;

export interface MembershipStoreContractOptions {
  /** Timeout (ms) for cases that race transactions or write a cap's worth of rows. */
  slowTimeoutMs?: number;
}

/** `make` must return a store with nothing in it. */
export function membershipStoreContract(
  name: string,
  make: () => Promise<MembershipStore>,
  options: MembershipStoreContractOptions = {},
): void {
  const itSlow = (title: string, fn: () => Promise<void>) => it(title, fn, options.slowTimeoutMs);
  const emails = (ms: Membership[]) => ms.map((m) => m.email);
  const fill = async (store: MembershipStore, projectId: string, from: number, count: number) => {
    for (let n = from; n < from + count; n++) {
      await store.put(membership({ projectId, email: emailN(n) }));
    }
  };

  describe(`MembershipStore contract: ${name}`, () => {
    it("GivenNothingStored_WhenRead_ThenNone", async () => {
      const store = await make();
      expect(await store.listForEmail("member@example.com")).toEqual([]);
      expect(await store.listForProject("p1")).toEqual([]);
      expect(await store.get("p1", "member@example.com")).toBeNull();
    });

    it("GivenMixedCaseEmail_WhenPutAndReadBack_ThenLowerCasedEverywhere", async () => {
      const store = await make();
      await store.put(membership({ email: "  Member@Example.COM " }));
      const stored = membership() as Membership;
      expect(await store.get("p1", "MEMBER@example.com")).toEqual(stored);
      expect(await store.listForEmail("Member@Example.com")).toEqual([stored]);
      expect(await store.listForProject("p1")).toEqual([stored]);
    });

    it("GivenSeveralProjects_WhenListed_ThenFilteredAndSorted", async () => {
      const store = await make();
      await store.put(membership({ projectId: "p2" }));
      await store.put(membership({ projectId: "p1", email: "zed@example.com" }));
      await store.put(membership({ projectId: "p1" }));
      expect(emails(await store.listForProject("p1"))).toEqual([
        "member@example.com",
        "zed@example.com",
      ]);
      expect((await store.listForEmail("member@example.com")).map((m) => m.projectId)).toEqual([
        "p1",
        "p2",
      ]);
    });

    it("GivenExistingMembership_WhenPutAgain_ThenReplaced", async () => {
      const store = await make();
      await store.put(membership());
      await store.put(membership({ email: "MEMBER@example.com", role: "viewer" }));
      expect(await store.listForProject("p1")).toEqual([membership({ role: "viewer" })]);
    });

    it("GivenInvalidMembership_WhenPut_ThenRejectedAndNothingStored", async () => {
      const store = await make();
      await expect(store.put(membership({ email: "not-an-email" }))).rejects.toThrow();
      await expect(
        store.put(membership({ role: "owner" as MembershipInput["role"] })),
      ).rejects.toThrow();
      await expect(store.put(membership({ projectId: "a/b" }))).rejects.toThrow();
      await expect(store.put(membership({ addedBy: "member@example.com" }))).rejects.toThrow();
      expect(await store.listForProject("p1")).toEqual([]);
    });

    itSlow("GivenFullProject_WhenNewMemberPut_ThenRefusedNamingTheCap", async () => {
      const store = await make();
      await fill(store, "p1", 0, MEMBERS_PER_PROJECT_MAX);
      const refused = store.put(membership({ email: "late@example.com" }));
      await expect(refused).rejects.toMatchObject({ cap: "MEMBERS_PER_PROJECT_MAX" });
      await expect(refused).rejects.toThrow(/MEMBERS_PER_PROJECT_MAX/);
      await expect(refused).rejects.not.toThrow(/late@example\.com/);
      // Replacing a member of a full project is not a new member.
      await store.put(membership({ email: emailN(0), role: "viewer" }));
      expect(await store.listForProject("p1")).toHaveLength(MEMBERS_PER_PROJECT_MAX);
    });

    itSlow("GivenAllMembershipsUsed_WhenNewMemberPut_ThenRefusedNamingTheCap", async () => {
      const store = await make();
      const projects = Math.ceil(MEMBERSHIPS_MAX / MEMBERS_PER_PROJECT_MAX);
      for (let p = 0; p < projects; p++) {
        const count = Math.min(
          MEMBERS_PER_PROJECT_MAX,
          MEMBERSHIPS_MAX - p * MEMBERS_PER_PROJECT_MAX,
        );
        await fill(store, `p${p}`, p * MEMBERS_PER_PROJECT_MAX, count);
      }
      const refused = store.put(membership({ projectId: "fresh", email: "late@example.com" }));
      await expect(refused).rejects.toMatchObject({ cap: "MEMBERSHIPS_MAX" });
      await expect(refused).rejects.toThrow(/MEMBERSHIPS_MAX/);
      expect(await store.listForProject("fresh")).toEqual([]);
    });

    itSlow("GivenOneSlotLeft_WhenTwoPutsRace_ThenOnlyOneLands", async () => {
      const store = await make();
      await fill(store, "p1", 0, MEMBERS_PER_PROJECT_MAX - 1);
      const results = await Promise.allSettled([
        store.put(membership({ email: "a@example.com" })),
        store.put(membership({ email: "b@example.com" })),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await store.listForProject("p1")).toHaveLength(MEMBERS_PER_PROJECT_MAX);
    });

    it("GivenMembership_WhenRemoved_ThenGoneAndSecondRemoveIsFalse", async () => {
      const store = await make();
      await store.put(membership());
      await store.put(membership({ projectId: "p2" }));
      expect(await store.remove("p1", "Member@Example.com")).toBe(true);
      expect(await store.remove("p1", "member@example.com")).toBe(false);
      expect(await store.get("p1", "member@example.com")).toBeNull();
      expect(await store.get("p2", "member@example.com")).not.toBeNull();
    });

    it("GivenMembershipsOfAnEmail_WhenSetUid_ThenEveryOneUpdatedAndOthersNot", async () => {
      const store = await make();
      await store.put(membership());
      await store.put(membership({ projectId: "p2" }));
      await store.put(membership({ email: "other@example.com" }));
      expect(await store.setUid("MEMBER@example.com", "uid-m", "Pat Member")).toBe(2);
      for (const m of await store.listForEmail("member@example.com")) {
        expect(m).toMatchObject({ uid: "uid-m", displayName: "Pat Member" });
      }
      expect(await store.get("p1", "other@example.com")).toMatchObject({ uid: null });
      expect(await store.setUid("nobody@example.com", "uid-n", null)).toBe(0);
      await expect(store.setUid("member@example.com", "bad/uid", null)).rejects.toThrow();
    });
  });
}
