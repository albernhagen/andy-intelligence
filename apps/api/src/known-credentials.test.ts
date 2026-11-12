import { describe, expect, it } from "vitest";
import { KnownCredentials } from "./known-credentials";

describe("KnownCredentials", () => {
  it("GivenARememberedCredential_WhenCheckedBeforeAndAfterItsTtl_ThenKnownThenForgotten", () => {
    let now = 0;
    const known = new KnownCredentials(10, 1000, () => now);
    known.remember("a");
    expect(known.has("a")).toBe(true);
    expect(known.has("b")).toBe(false);
    now = 1000;
    expect(known.has("a")).toBe(false);
  });

  it("GivenARememberedCredential_WhenForgotten_ThenUnknown", () => {
    const known = new KnownCredentials(10, 60_000, () => 0);
    known.remember("a");
    known.forget("a");
    expect(known.has("a")).toBe(false);
  });

  it("GivenAFullCache_WhenANewCredentialIsRemembered_ThenTheOldestIsForgotten", () => {
    const known = new KnownCredentials(2, 60_000, () => 0);
    known.remember("a");
    known.remember("b");
    known.remember("a");
    known.remember("c");
    expect([known.has("a"), known.has("b"), known.has("c")]).toEqual([true, false, true]);
  });
});
