import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashToken, newToken, verifyPkceS256 } from "./tokens";

const verifier = "a".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");

describe("tokens", () => {
  it("GivenNewTokens_WhenGenerated_ThenTheyAreUniqueAnd256Bit", () => {
    const a = newToken();
    expect(a).not.toBe(newToken());
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
  });

  it("GivenAToken_WhenHashed_ThenTheHashIsStableAndNotTheToken", () => {
    const t = newToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(t);
  });

  it("GivenTheMatchingVerifier_WhenCheckingPkce_ThenItPasses", () => {
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it("GivenAWrongOrMalformedVerifier_WhenCheckingPkce_ThenItFails", () => {
    expect(verifyPkceS256("b".repeat(43), challenge)).toBe(false);
    expect(verifyPkceS256("short", challenge)).toBe(false);
    expect(verifyPkceS256(verifier, "")).toBe(false);
  });
});
