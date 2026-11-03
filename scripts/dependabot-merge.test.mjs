import { describe, expect, it } from "vitest";
import { decide } from "./dependabot-merge.mjs";

const patch = "version-update:semver-patch";
const minor = "version-update:semver-minor";
const major = "version-update:semver-major";

describe("decide", () => {
  it.each([
    ["npm_and_yarn", patch],
    ["npm_and_yarn", minor],
    ["github_actions", patch],
    ["github_actions", minor],
  ])("GivenEcosystem%sAnd%s_WhenDecided_ThenMerges", (ecosystem, updateType) => {
    expect(decide({ ecosystem, updateType }).merge).toBe(true);
  });

  it("GivenMajorUpdate_WhenDecided_ThenLeftForAndy", () => {
    const result = decide({ ecosystem: "npm_and_yarn", updateType: major });
    expect(result).toEqual({ merge: false, reason: expect.stringContaining(major) });
  });

  it("GivenTerraformProvider_WhenDecided_ThenLeftForAndy", () => {
    expect(decide({ ecosystem: "terraform", updateType: patch }).merge).toBe(false);
  });

  it("GivenMissingMetadata_WhenDecided_ThenLeftForAndy", () => {
    expect(decide({ ecosystem: "", updateType: "" })).toEqual({
      merge: false,
      reason: expect.stringContaining("unknown"),
    });
    expect(decide({ ecosystem: "npm_and_yarn", updateType: undefined }).merge).toBe(false);
  });
});
