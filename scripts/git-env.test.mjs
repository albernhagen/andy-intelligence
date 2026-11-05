import { describe, expect, it } from "vitest";
import { cleanGitEnv } from "./git-env.mjs";

describe("cleanGitEnv", () => {
  it("GivenGitHookVariables_WhenCleaned_ThenOnlyGitVariablesRemoved", () => {
    const env = {
      PATH: "/bin",
      GIT_DIR: "/r/.git",
      GIT_INDEX_FILE: "/r/.git/index",
      GITHUB_TOKEN: "x",
    };
    expect(cleanGitEnv(env)).toEqual({ PATH: "/bin", GITHUB_TOKEN: "x" });
  });

  it("GivenNoArgument_WhenCleaned_ThenUsesProcessEnvWithoutMutatingIt", () => {
    process.env.GIT_TEST_MARKER = "1";
    try {
      expect(cleanGitEnv()).not.toHaveProperty("GIT_TEST_MARKER");
      expect(process.env.GIT_TEST_MARKER).toBe("1");
    } finally {
      delete process.env.GIT_TEST_MARKER;
    }
  });
});
