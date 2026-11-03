import { readFileSync } from "node:fs";
import { codeHostContract } from "@andy/contracts/testing";
import { describe, it } from "vitest";
import { GitHubCodeHost } from "./code-host";

// Runs only against real GitHub, on Andy's machine (docs/runbooks/github-app.md §6):
// GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_FILE, GITHUB_CONTRACT_REPO (a repo with the App).
const { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_FILE, GITHUB_CONTRACT_REPO } = process.env;

if (GITHUB_APP_ID && GITHUB_APP_PRIVATE_KEY_FILE && GITHUB_CONTRACT_REPO) {
  const privateKey = readFileSync(GITHUB_APP_PRIVATE_KEY_FILE, "utf8");
  codeHostContract("github", async () => ({
    host: new GitHubCodeHost({ appId: GITHUB_APP_ID, privateKey }),
    knownRepo: GITHUB_CONTRACT_REPO,
    unknownRepo: "octocat/Hello-World",
  }));
} else {
  describe("CodeHost contract: github", () => {
    it.skip("needs a GitHub App: docs/runbooks/github-app.md §6", () => {});
  });
}
