import { describe, expect, it } from "vitest";
import { InMemoryCodeHost } from "./index";

const REPO = "albernhagen/andy-intelligence";
const A = "a".repeat(40);
const B = "b".repeat(40);

describe("InMemoryCodeHost.listCommitsBetween", () => {
  const host = () =>
    new InMemoryCodeHost([
      { fullName: REPO, defaultBranch: "main", private: false, url: `https://github.com/${REPO}` },
    ]);

  it("GivenASeededRange_WhenListed_ThenACopyOfIt", async () => {
    const h = host();
    const range = {
      status: "ahead" as const,
      commits: { items: [{ sha: "1".repeat(40), title: "x (#1)" }], complete: true },
    };
    h.commitRanges.set(`${A}...${B}`, range);
    const read = await h.listCommitsBetween(REPO, A, B);
    expect(read).toEqual(range);
    read!.commits.items.length = 0;
    expect(await h.listCommitsBetween(REPO, A, B)).toEqual(range);
  });

  it("GivenAnUnknownRangeOrRepo_WhenListed_ThenNull", async () => {
    const h = host();
    h.commitRanges.set(`${A}...${B}`, {
      status: "identical",
      commits: { items: [], complete: true },
    });
    expect(await h.listCommitsBetween(REPO, B, A)).toBeNull();
    expect(await h.listCommitsBetween("someone/else", A, B)).toBeNull();
  });
});
