import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GitHubCodeHost } from "./code-host";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" }, // the format GitHub hands out
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Routes GitHub API calls by method + path; anything else is a 500. */
function fakeGitHub(routes: Record<string, (init?: RequestInit) => Response>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    // Octokit encodes `/` in a path parameter (as GitHub accepts it): match the decoded path.
    const route = routes[`${init?.method ?? "GET"} ${decodeURIComponent(url.pathname)}`];
    return route ? route(init) : json(500, { message: `unexpected ${url.pathname}` });
  });
}

/** Like GitHub: the run's ID comes back only when the request sets `return_run_details`. */
const dispatches = (init?: RequestInit) =>
  (JSON.parse(String(init?.body ?? "{}")) as { return_run_details?: boolean })
    .return_run_details === true
    ? json(200, {
        workflow_run_id: 123,
        run_url: "https://api.github.com/repos/albernhagen/andy-intelligence/actions/runs/123",
        html_url: "https://github.com/albernhagen/andy-intelligence/actions/runs/123",
      })
    : new Response(null, { status: 204 });

const installed = {
  "GET /repos/albernhagen/andy-intelligence/installation": () => json(200, { id: 42 }),
  "POST /app/installations/42/access_tokens": () =>
    json(201, {
      token: "ghs_test",
      expires_at: "2099-01-01T00:00:00Z",
      permissions: {},
      repository_selection: "selected",
    }),
  "GET /repos/albernhagen/andy-intelligence": () =>
    json(200, {
      full_name: "albernhagen/andy-intelligence",
      default_branch: "main",
      private: false,
      html_url: "https://github.com/albernhagen/andy-intelligence",
    }),
};

const host = (fetch: typeof globalThis.fetch) =>
  new GitHubCodeHost({ appId: "1", slug: "andy-intelligence", privateKey }, fetch);

describe("GitHubCodeHost", () => {
  it("GivenTheAppIsInstalled_WhenGetRepo_ThenTheRepoIsReadWithAnInstallationToken", async () => {
    const fetch = fakeGitHub(installed);
    expect(await host(fetch).getRepo("albernhagen/andy-intelligence")).toEqual({
      fullName: "albernhagen/andy-intelligence",
      defaultBranch: "main",
      private: false,
      url: "https://github.com/albernhagen/andy-intelligence",
    });
    const repoCall = fetch.mock.calls.find(([u]) => String(u).endsWith("/andy-intelligence"));
    expect(new Headers(repoCall?.[1]?.headers).get("authorization")).toBe("token ghs_test");
    const installCall = fetch.mock.calls.find(([u]) => String(u).endsWith("/installation"));
    expect(new Headers(installCall?.[1]?.headers).get("authorization")).toMatch(/^bearer ey/i);
  });

  it("GivenTheAppIsNotInstalled_WhenGetRepo_ThenNull", async () => {
    const fetch = fakeGitHub({
      "GET /repos/albernhagen/other/installation": () => json(404, { message: "Not Found" }),
    });
    expect(await host(fetch).getRepo("albernhagen/other")).toBeNull();
  });

  it("GivenAMalformedName_WhenGetRepo_ThenNullWithoutCallingGitHub", async () => {
    const fetch = fakeGitHub({});
    expect(await host(fetch).getRepo("../../app")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("GivenGitHubFails_WhenGetRepo_ThenTheErrorPropagates", async () => {
    const fetch = fakeGitHub({});
    await expect(host(fetch).getRepo("albernhagen/andy-intelligence")).rejects.toMatchObject({
      status: 500,
    });
  });

  it("GivenTwoInstallations_WhenListingRepos_ThenAllReposAreReturnedSorted", async () => {
    const repo = (full_name: string) => ({
      full_name,
      default_branch: "main",
      private: false,
      html_url: `https://github.com/${full_name}`,
    });
    const token = (t: string) => () =>
      json(201, { token: t, expires_at: "2099-01-01T00:00:00Z", permissions: {} });
    const fetch = fakeGitHub({
      "GET /app/installations": () => json(200, [{ id: 1 }, { id: 2 }]),
      "POST /app/installations/1/access_tokens": token("t1"),
      "POST /app/installations/2/access_tokens": token("t2"),
      "GET /installation/repositories": () => json(200, { repositories: [repo("b/two")] }),
    });
    const repos = await host(fetch).listInstalledRepos();
    expect(repos.map((r) => r.fullName)).toEqual(["b/two", "b/two"]);
  });

  it("GivenAnInstalledRepo_WhenATokenIsIssued_ThenItIsScopedToThatRepoWithWriteAccess", async () => {
    const fetch = fakeGitHub(installed);
    expect(await host(fetch).issueRepoToken("albernhagen/andy-intelligence")).toEqual({
      token: "ghs_test",
      expiresAt: "2099-01-01T00:00:00Z",
      actor: "andy-intelligence[bot]",
    });
    const call = fetch.mock.calls.find(([u]) => String(u).endsWith("/access_tokens"));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      repositories: ["andy-intelligence"],
      permissions: { contents: "write", pull_requests: "write" },
    });
  });

  it("GivenTheAppIsNotInstalled_WhenATokenIsRequested_ThenNull", async () => {
    const fetch = fakeGitHub({
      "GET /repos/albernhagen/other/installation": () => json(404, { message: "Not Found" }),
    });
    expect(await host(fetch).issueRepoToken("albernhagen/other")).toBeNull();
  });

  it("GivenAnInstalledRepo_WhenAWorkflowIsDispatched_ThenItRunsOnTheDefaultBranchAndItsIdIsReturned", async () => {
    const fetch = fakeGitHub({
      ...installed,
      "POST /repos/albernhagen/andy-intelligence/actions/workflows/agent-run.yml/dispatches":
        dispatches,
    });
    const dispatch = await host(fetch).dispatchWorkflow(
      "albernhagen/andy-intelligence",
      "agent-run.yml",
      { run_id: "r1", credential: "subscription" },
    );
    expect(dispatch).toEqual({
      id: "123",
      url: "https://github.com/albernhagen/andy-intelligence/actions/runs/123",
    });
    const call = fetch.mock.calls.find(([u]) => String(u).endsWith("/dispatches"));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      ref: "main",
      inputs: { run_id: "r1", credential: "subscription" },
      return_run_details: true,
    });
  });

  it("GivenGitHubReturnsNoRunId_WhenAWorkflowIsDispatched_ThenItFails", async () => {
    const fetch = fakeGitHub({
      ...installed,
      "POST /repos/albernhagen/andy-intelligence/actions/workflows/agent-run.yml/dispatches": () =>
        new Response(null, { status: 204 }),
    });
    await expect(
      host(fetch).dispatchWorkflow("albernhagen/andy-intelligence", "agent-run.yml", {}),
    ).rejects.toThrow(/run's ID/);
  });

  it("GivenAPathInTheWorkflowName_WhenDispatched_ThenItIsRefused", async () => {
    const fetch = fakeGitHub(installed);
    await expect(
      host(fetch).dispatchWorkflow("albernhagen/andy-intelligence", "../x.yml", {}),
    ).rejects.toThrow(/workflow file/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("GivenACompletedWorkflowRun_WhenRead_ThenItIsMapped", async () => {
    const fetch = fakeGitHub({
      ...installed,
      "GET /repos/albernhagen/andy-intelligence/actions/runs/123": () =>
        json(200, {
          id: 123,
          name: "Agent run r1",
          event: "workflow_dispatch",
          status: "completed",
          conclusion: "success",
          head_branch: "main",
          head_sha: "abc",
          html_url: "https://github.com/albernhagen/andy-intelligence/actions/runs/123",
        }),
    });
    const run = await host(fetch).getWorkflowRun("albernhagen/andy-intelligence", "123");
    expect(run).toMatchObject({ id: "123", status: "completed", conclusion: "success" });
  });

  describe("gate reads and merge", () => {
    const R = "/repos/albernhagen/andy-intelligence";
    it("GivenAnOpenPr_WhenRead_ThenItMapsToTheDomainShape", async () => {
      const fetch = fakeGitHub({
        ...installed,
        [`GET ${R}/pulls/5`]: () =>
          json(200, {
            number: 5,
            state: "open",
            merged: false,
            draft: false,
            title: "AI-1: x",
            body: "first\nsecond",
            head: { ref: "agent/AI-1/r", sha: "abc", repo: { full_name: "a/b" } },
            base: { ref: "main", repo: { full_name: "a/b", default_branch: "main" } },
            html_url: "https://github.com/a/b/pull/5",
          }),
      });
      expect(await host(fetch).getPullRequest("albernhagen/andy-intelligence", 5)).toMatchObject({
        state: "open",
        bodyFirstLine: "first",
        fromFork: false,
        intoDefaultBranch: true,
        headSha: "abc",
      });
    });

    it("GivenAMergedPr_WhenDetailsRead_ThenBodyMergerAndTimeAreMapped", async () => {
      const fetch = fakeGitHub({
        ...installed,
        [`GET ${R}/pulls/6`]: () =>
          json(200, {
            body: `What changed: x\n${"y".repeat(30_000)}`,
            merged_by: { login: "albernhagen" },
            merged_at: "2026-11-20T10:00:00Z",
          }),
      });
      const details = await host(fetch).getPullRequestDetails("albernhagen/andy-intelligence", 6);
      expect(details).toMatchObject({ mergedBy: "albernhagen", mergedAt: "2026-11-20T10:00:00Z" });
      expect(details?.body).toHaveLength(20_000);
      expect(details?.body.startsWith("What changed: x")).toBe(true);
    });

    it("GivenAThreePageFileList_WhenListed_ThenRenamesKeptAndMarkedIncomplete", async () => {
      const full = Array.from({ length: 100 }, (_, i) => ({
        filename: `f${i}`,
        previous_filename: i === 0 ? "old" : undefined,
      }));
      const fetch = fakeGitHub({ ...installed, [`GET ${R}/pulls/5/files`]: () => json(200, full) });
      const files = await host(fetch).listChangedFiles("albernhagen/andy-intelligence", 5);
      expect(files.complete).toBe(false);
      expect(files.items[0]).toEqual({ path: "f0", previousPath: "old" });
      expect(files.items).toHaveLength(300);
    });

    it("GivenMoreChecksThanOnePage_WhenListed_ThenIncomplete", async () => {
      const fetch = fakeGitHub({
        ...installed,
        [`GET ${R}/commits/abc/check-runs`]: () =>
          json(200, {
            total_count: 101,
            check_runs: [
              { name: "check", status: "completed", conclusion: "success", app: { id: 15368 } },
            ],
          }),
      });
      expect(await host(fetch).listHeadChecks("albernhagen/andy-intelligence", "abc")).toEqual({
        complete: false,
        items: [{ name: "check", status: "completed", conclusion: "success", sourceId: "15368" }],
      });
    });

    it("GivenBranchRules_WhenRequiredChecksRead_ThenOnlyStatusChecksReturn", async () => {
      const fetch = fakeGitHub({
        ...installed,
        [`GET ${R}/rules/branches/main`]: () =>
          json(200, [
            { type: "deletion" },
            {
              type: "required_status_checks",
              parameters: {
                required_status_checks: [
                  { context: "check", integration_id: 15368 },
                  { context: "x" },
                ],
              },
            },
          ]),
      });
      expect(await host(fetch).listRequiredChecks("albernhagen/andy-intelligence", "main")).toEqual(
        [
          { name: "check", sourceId: "15368" },
          { name: "x", sourceId: null },
        ],
      );
    });

    it("GivenBotAndHumanCommits_WhenListed_ThenLoginWinsElseGitName", async () => {
      const fetch = fakeGitHub({
        ...installed,
        [`GET ${R}/pulls/5/commits`]: () =>
          json(200, [
            { sha: "a", author: null, commit: { author: { name: "x-control[bot]" } } },
            { sha: "b", author: { login: "albernhagen" }, commit: { author: { name: "Andy" } } },
          ]),
      });
      const { items } = await host(fetch).listPullRequestCommits(
        "albernhagen/andy-intelligence",
        5,
      );
      expect(items.map((c) => c.author)).toEqual(["x-control[bot]", "albernhagen"]);
    });

    it("GivenAFile_WhenRead_ThenDecodedAndAnOversizedOneThrows", async () => {
      const good = fakeGitHub({
        ...installed,
        [`GET ${R}/contents/CODEOWNERS`]: () =>
          json(200, {
            type: "file",
            size: 3,
            content: Buffer.from("hi\n").toString("base64"),
          }),
      });
      expect(await host(good).readFile("albernhagen/andy-intelligence", "CODEOWNERS", "main")).toBe(
        "hi\n",
      );
      const big = fakeGitHub({
        ...installed,
        [`GET ${R}/contents/CODEOWNERS`]: () => json(200, { type: "file", size: 9e6, content: "" }),
      });
      await expect(
        host(big).readFile("albernhagen/andy-intelligence", "CODEOWNERS", "main"),
      ).rejects.toThrow(/too large/);
    });

    it("GivenAFolder_WhenListed_ThenFileNamesSortedAndAMissingOneNull", async () => {
      const fetch = fakeGitHub({
        ...installed,
        [`GET ${R}/contents/docs/adr`]: () =>
          json(200, [
            { type: "file", name: "0002-b.md" },
            { type: "dir", name: "history" },
            { type: "file", name: "0001-a.md" },
          ]),
        [`GET ${R}/contents/missing`]: () => json(404, { message: "Not Found" }),
      });
      const gh = host(fetch);
      expect(await gh.listFiles("albernhagen/andy-intelligence", "docs/adr", "main")).toEqual([
        "0001-a.md",
        "0002-b.md",
      ]);
      expect(await gh.listFiles("albernhagen/andy-intelligence", "missing", "main")).toBeNull();
    });

    it("GivenAMerge_WhenCalled_ThenItSquashesPinnedToTheHeadSha", async () => {
      const put = vi.fn((_init?: RequestInit) => json(200, { merged: true, sha: SHA }));
      const fetch = fakeGitHub({ ...installed, [`PUT ${R}/pulls/5/merge`]: put });
      expect(await host(fetch).mergePullRequest("albernhagen/andy-intelligence", 5, "abc")).toBe(
        SHA,
      );
      expect(JSON.parse(String(put.mock.calls[0]![0]!.body))).toMatchObject({
        merge_method: "squash",
        sha: "abc",
      });
    });

    it("GivenTheHostRefuses_WhenMerging_ThenItThrows", async () => {
      const fetch = fakeGitHub({
        ...installed,
        [`PUT ${R}/pulls/5/merge`]: () => json(405, { message: "not mergeable" }),
      });
      await expect(
        host(fetch).mergePullRequest("albernhagen/andy-intelligence", 5, "abc"),
      ).rejects.toThrow(/not mergeable/);
    });

    it.each([
      ["ahead", true],
      ["identical", true],
      ["behind", false],
      ["diverged", false],
    ])(
      "GivenACompareStatus%s_WhenAskedIfTheHeadContainsMain_ThenItAnswers%s",
      async (status, expected) => {
        const fetch = fakeGitHub({
          ...installed,
          [`GET ${R}/compare/main...abc`]: () => json(200, { status }),
        });
        const contains = await host(fetch).headContains(
          "albernhagen/andy-intelligence",
          "abc",
          "main",
        );
        expect(contains).toBe(expected);
      },
    );

    it("GivenACleanUpdate_WhenTheBranchIsUpdated_ThenItIsPinnedToTheHeadAndUpdated", async () => {
      const put = vi.fn((_init?: RequestInit) =>
        json(202, { message: "Updating pull request branch." }),
      );
      const fetch = fakeGitHub({ ...installed, [`PUT ${R}/pulls/5/update-branch`]: put });
      expect(await host(fetch).updateBranch("albernhagen/andy-intelligence", 5, "abc")).toBe(
        "updated",
      );
      expect(JSON.parse(String(put.mock.calls[0]![0]!.body))).toMatchObject({
        expected_head_sha: "abc",
      });
    });

    it.each([
      ["expected head sha didn't match current head ref.", "head_moved"],
      ["merge conflict between base and head", "conflict"],
    ])("GivenA422Saying%s_WhenTheBranchIsUpdated_ThenItAnswers%s", async (message, expected) => {
      const fetch = fakeGitHub({
        ...installed,
        [`PUT ${R}/pulls/5/update-branch`]: () => json(422, { message }),
      });
      expect(await host(fetch).updateBranch("albernhagen/andy-intelligence", 5, "abc")).toBe(
        expected,
      );
    });

    it("GivenAnotherRefusal_WhenTheBranchIsUpdated_ThenItThrows", async () => {
      const fetch = fakeGitHub({
        ...installed,
        [`PUT ${R}/pulls/5/update-branch`]: () => json(403, { message: "forbidden" }),
      });
      await expect(
        host(fetch).updateBranch("albernhagen/andy-intelligence", 5, "abc"),
      ).rejects.toThrow(/forbidden/);
    });

    const file = (patch: string | undefined, changes = 1) => ({
      filename: "a.ts",
      status: "modified",
      changes,
      ...(patch === undefined ? {} : { patch }),
    });
    const digestOf = async (files: unknown[]) =>
      host(
        fakeGitHub({ ...installed, [`GET ${R}/pulls/5/files`]: () => json(200, files) }),
      ).diffDigest("albernhagen/andy-intelligence", 5);

    it("GivenTheSameLinesAtOtherLineNumbers_WhenDigested_ThenTheDigestIsTheSame", async () => {
      const before = await digestOf([file("@@ -1,2 +1,3 @@ fn\n a\n+b")]);
      const after = await digestOf([file("@@ -40,2 +41,3 @@ other\n a\n+b")]);
      expect(before).toMatch(/^[0-9a-f]{64}$/);
      expect(after).toBe(before);
    });

    it("GivenAChangedLine_WhenDigested_ThenTheDigestDiffers", async () => {
      const before = await digestOf([file("@@ -1,2 +1,3 @@\n a\n+b")]);
      expect(await digestOf([file("@@ -1,2 +1,3 @@\n a\n+c")])).not.toBe(before);
    });

    it("GivenAFileWithNoPatch_WhenDigested_ThenNullButAPureRenameStillDigests", async () => {
      expect(await digestOf([file(undefined, 10)])).toBeNull();
      expect(
        await digestOf([{ ...file(undefined, 0), status: "renamed", previous_filename: "b.ts" }]),
      ).toMatch(/^[0-9a-f]{64}$/);
    });

    const SHA = "a".repeat(40);
    // The fake matches decoded paths, so the ref's encoded slashes read as `/` here.
    const refPath = (branch: string) => `GET ${R}/git/ref/heads/${branch}`;

    it("GivenABranch_WhenItsTipIsRead_ThenTheShaComesBackAndAMissingOneIsNull", async () => {
      const fetch = fakeGitHub({
        ...installed,
        [refPath("main")]: () => json(200, { ref: "refs/heads/main", object: { sha: SHA } }),
        [refPath("epic/AI-84")]: () => json(404, { message: "Not Found" }),
      });
      expect(await host(fetch).branchSha("albernhagen/andy-intelligence", "main")).toBe(SHA);
      expect(await host(fetch).branchSha("albernhagen/andy-intelligence", "epic/AI-84")).toBeNull();
    });

    it("GivenAnUnsafeBranchName_WhenItsTipIsRead_ThenItThrowsWithoutCallingGitHub", async () => {
      const fetch = fakeGitHub(installed);
      await expect(
        host(fetch).branchSha("albernhagen/andy-intelligence", "../main"),
      ).rejects.toThrow(/unexpected branch/);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("GivenAnEpicBranch_WhenCreated_ThenTheRefIsMadeAtTheSha", async () => {
      const post = vi.fn((_init?: RequestInit) => json(201, { ref: "refs/heads/epic/AI-84" }));
      const fetch = fakeGitHub({ ...installed, [`POST ${R}/git/refs`]: post });
      expect(
        await host(fetch).createBranch("albernhagen/andy-intelligence", "epic/AI-84", SHA),
      ).toBe("created");
      expect(JSON.parse(String(post.mock.calls[0]![0]!.body))).toEqual({
        ref: "refs/heads/epic/AI-84",
        sha: SHA,
      });
    });

    it("GivenTheBranchExists_WhenCreated_ThenExistsAndOtherRefusalsThrow", async () => {
      const exists = fakeGitHub({
        ...installed,
        [`POST ${R}/git/refs`]: () => json(422, { message: "Reference already exists" }),
      });
      expect(
        await host(exists).createBranch("albernhagen/andy-intelligence", "epic/AI-84", SHA),
      ).toBe("exists");
      const bad = fakeGitHub({
        ...installed,
        [`POST ${R}/git/refs`]: () => json(422, { message: "Object does not exist" }),
      });
      await expect(
        host(bad).createBranch("albernhagen/andy-intelligence", "epic/AI-84", SHA),
      ).rejects.toThrow(/Object does not exist/);
    });

    it.each(["main", "agent/AI-1/run", "epic/AI-84/x", "epic/ai-84"])(
      "GivenTheBranch%s_WhenCreated_ThenRefusedWithoutCallingGitHub",
      async (branch) => {
        const fetch = fakeGitHub(installed);
        await expect(
          host(fetch).createBranch("albernhagen/andy-intelligence", branch, SHA),
        ).rejects.toThrow(/only epic/);
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    it("GivenAnEpicBranch_WhenTheMorningPrOpens_ThenItTargetsTheBaseAndReturnsThePr", async () => {
      const post = vi.fn((_init?: RequestInit) =>
        json(201, { number: 900, html_url: "https://github.com/a/b/pull/900" }),
      );
      const fetch = fakeGitHub({ ...installed, [`POST ${R}/pulls`]: post });
      const pr = { head: "epic/AI-84", base: "main", title: "AI-84: X (overnight)", body: "b" };
      expect(await host(fetch).openEpicPullRequest("albernhagen/andy-intelligence", pr)).toEqual({
        number: 900,
        url: "https://github.com/a/b/pull/900",
      });
      expect(JSON.parse(String(post.mock.calls[0]![0]!.body))).toEqual(pr);
    });

    it("GivenAnOpenPrForTheHeadAlready_WhenTheMorningPrOpens_ThenExists", async () => {
      const fetch = fakeGitHub({
        ...installed,
        [`POST ${R}/pulls`]: () =>
          json(422, { message: "A pull request already exists for albernhagen:epic/AI-84." }),
      });
      const pr = { head: "epic/AI-84", base: "main", title: "t", body: "b" };
      expect(await host(fetch).openEpicPullRequest("albernhagen/andy-intelligence", pr)).toBe(
        "exists",
      );
    });

    it.each(["main", "agent/AI-1/run", "epic/AI-84/x"])(
      "GivenTheHead%s_WhenAMorningPrOrDeleteIsAsked_ThenRefusedWithoutCallingGitHub",
      async (branch) => {
        const fetch = fakeGitHub(installed);
        const pr = { head: branch, base: "main", title: "t", body: "b" };
        await expect(
          host(fetch).openEpicPullRequest("albernhagen/andy-intelligence", pr),
        ).rejects.toThrow(/only epic/);
        await expect(
          host(fetch).deleteEpicBranch("albernhagen/andy-intelligence", branch),
        ).rejects.toThrow(/only epic/);
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    it("GivenAnEpicBranch_WhenDeleted_ThenItsRefGoesAndAMissingOneIsFine", async () => {
      const del = vi.fn(() => new Response(null, { status: 204 }));
      const fetch = fakeGitHub({ ...installed, [`DELETE ${R}/git/refs/heads/epic/AI-84`]: del });
      await host(fetch).deleteEpicBranch("albernhagen/andy-intelligence", "epic/AI-84");
      expect(del).toHaveBeenCalledTimes(1);
      const gone = fakeGitHub({
        ...installed,
        [`DELETE ${R}/git/refs/heads/epic/AI-84`]: () => json(404, { message: "Not Found" }),
      });
      await expect(
        host(gone).deleteEpicBranch("albernhagen/andy-intelligence", "epic/AI-84"),
      ).resolves.toBeUndefined();
    });

    it("GivenAnUnknownRef_WhenAskedIfTheHeadContainsMain_ThenNull", async () => {
      const fetch = fakeGitHub({
        ...installed,
        [`GET ${R}/compare/main...abc`]: () => json(404, { message: "Not Found" }),
      });
      expect(await host(fetch).headContains("albernhagen/andy-intelligence", "abc", "main")).toBe(
        null,
      );
    });
  });
  describe("proposeFile", () => {
    const R = "/repos/albernhagen/andy-intelligence";
    const proposal = {
      branch: "brief/ai-20261112080000",
      path: "docs/product/brief.md",
      content: "# Project brief\n",
      message: "Project brief",
      title: "AI: Project brief",
      body: "Rendered from the onboarding answers.",
    };
    const routes = (existing: boolean, put: (init?: RequestInit) => Response) => ({
      ...installed,
      [`GET ${R}/git/ref/heads/main`]: () => json(200, { object: { sha: "basesha" } }),
      [`POST ${R}/git/refs`]: (init?: RequestInit) =>
        json(201, { ref: JSON.parse(String(init?.body)).ref }),
      [`GET ${R}/contents/docs/product/brief.md`]: () =>
        existing ? json(200, { type: "file", sha: "blobsha", size: 3 }) : json(404, {}),
      [`PUT ${R}/contents/docs/product/brief.md`]: put,
      [`POST ${R}/pulls`]: () =>
        json(201, {
          number: 7,
          html_url: "https://github.com/albernhagen/andy-intelligence/pull/7",
        }),
    });

    it("GivenANewFile_WhenProposed_ThenABranchFromTheDefaultHeadCommitsItAndAPrOpens", async () => {
      const put = vi.fn((_init?: RequestInit) => json(201, {}));
      const fetch = fakeGitHub(routes(false, put));
      expect(await host(fetch).proposeFile("albernhagen/andy-intelligence", proposal)).toEqual({
        number: 7,
        url: "https://github.com/albernhagen/andy-intelligence/pull/7",
        branch: proposal.branch,
      });
      const body = JSON.parse(String(put.mock.calls[0]![0]!.body));
      expect(body).toMatchObject({ branch: proposal.branch, message: "Project brief" });
      expect(body.sha).toBeUndefined();
      expect(Buffer.from(body.content, "base64").toString("utf8")).toBe(proposal.content);
    });

    it("GivenAnExistingFile_WhenProposed_ThenItIsReplacedByItsBlobSha", async () => {
      const put = vi.fn((_init?: RequestInit) => json(200, {}));
      await host(fakeGitHub(routes(true, put))).proposeFile(
        "albernhagen/andy-intelligence",
        proposal,
      );
      expect(JSON.parse(String(put.mock.calls[0]![0]!.body)).sha).toBe("blobsha");
    });

    it("GivenTheBranchExists_WhenProposed_ThenItThrowsAndNothingIsCommitted", async () => {
      const put = vi.fn((_init?: RequestInit) => json(201, {}));
      const fetch = fakeGitHub({
        ...routes(false, put),
        [`POST ${R}/git/refs`]: () => json(422, { message: "Reference already exists" }),
      });
      await expect(
        host(fetch).proposeFile("albernhagen/andy-intelligence", proposal),
      ).rejects.toThrow(/already exists/);
      expect(put).not.toHaveBeenCalled();
    });

    it("GivenTheCommitFails_WhenProposed_ThenTheNewBranchIsDeletedAndItThrows", async () => {
      const del = vi.fn((_init?: RequestInit) => new Response(null, { status: 204 }));
      const fetch = fakeGitHub({
        ...routes(false, () => json(500, { message: "boom" })),
        [`DELETE ${R}/git/refs/heads/${proposal.branch}`]: del,
      });
      await expect(
        host(fetch).proposeFile("albernhagen/andy-intelligence", proposal),
      ).rejects.toThrow(/boom/);
      expect(del).toHaveBeenCalledOnce();
    });

    it("GivenTheAppIsNotInstalled_WhenProposed_ThenNull", async () => {
      const fetch = fakeGitHub({
        "GET /repos/albernhagen/other/installation": () => json(404, { message: "Not Found" }),
      });
      expect(await host(fetch).proposeFile("albernhagen/other", proposal)).toBeNull();
    });
  });
  describe("proposeFiles", () => {
    const R = "/repos/albernhagen/andy-intelligence";
    const proposal = {
      branch: "baseline/abc1234",
      files: [
        { path: "lefthook.yml", content: "pre-commit: {}\n" },
        { path: ".andy/baseline.json", content: "{}\n" },
      ],
      message: "Project baseline main (abc1234)",
      title: "Project baseline main (abc1234)",
      body: "Report",
    };
    const routes = (overrides: Record<string, (init?: RequestInit) => Response> = {}) => ({
      ...installed,
      [`GET ${R}/git/ref/heads/main`]: () => json(200, { object: { sha: "basesha" } }),
      [`GET ${R}/git/commits/basesha`]: () => json(200, { tree: { sha: "basetree" } }),
      [`POST ${R}/git/trees`]: () => json(201, { sha: "newtree" }),
      [`POST ${R}/git/commits`]: () => json(201, { sha: "newcommit" }),
      [`POST ${R}/git/refs`]: () => json(201, {}),
      [`POST ${R}/pulls`]: () =>
        json(201, {
          number: 9,
          html_url: "https://github.com/albernhagen/andy-intelligence/pull/9",
        }),
      ...overrides,
    });

    it("GivenAnInstalledRepo_WhenProposed_ThenOneCommitOnANewBranchFromTheDefaultHeadAndAPrOpens", async () => {
      const tree = vi.fn((_init?: RequestInit) => json(201, { sha: "newtree" }));
      const commit = vi.fn((_init?: RequestInit) => json(201, { sha: "newcommit" }));
      const ref = vi.fn((_init?: RequestInit) => json(201, {}));
      const fetch = fakeGitHub(
        routes({
          [`POST ${R}/git/trees`]: tree,
          [`POST ${R}/git/commits`]: commit,
          [`POST ${R}/git/refs`]: ref,
        }),
      );
      expect(await host(fetch).proposeFiles("albernhagen/andy-intelligence", proposal)).toEqual({
        number: 9,
        url: "https://github.com/albernhagen/andy-intelligence/pull/9",
        branch: "baseline/abc1234",
      });
      const treeBody = JSON.parse(String(tree.mock.calls[0]![0]!.body));
      expect(treeBody.base_tree).toBe("basetree");
      expect(treeBody.tree).toEqual([
        { path: "lefthook.yml", mode: "100644", type: "blob", content: "pre-commit: {}\n" },
        { path: ".andy/baseline.json", mode: "100644", type: "blob", content: "{}\n" },
      ]);
      expect(JSON.parse(String(commit.mock.calls[0]![0]!.body))).toMatchObject({
        tree: "newtree",
        parents: ["basesha"],
      });
      expect(JSON.parse(String(ref.mock.calls[0]![0]!.body))).toEqual({
        ref: "refs/heads/baseline/abc1234",
        sha: "newcommit",
      });
    });

    it("GivenAnEmptyRepo_WhenProposed_ThenItThrowsBeforeWriting", async () => {
      const tree = vi.fn((_init?: RequestInit) => json(201, { sha: "newtree" }));
      const fetch = fakeGitHub(
        routes({
          [`GET ${R}/git/ref/heads/main`]: () => json(409, { message: "Git Repository is empty." }),
          [`POST ${R}/git/trees`]: tree,
        }),
      );
      await expect(
        host(fetch).proposeFiles("albernhagen/andy-intelligence", proposal),
      ).rejects.toThrow(/is empty/);
      expect(tree).not.toHaveBeenCalled();
    });

    it("GivenTheBranchExists_WhenProposed_ThenItThrowsAndNoPrOpens", async () => {
      const pulls = vi.fn((_init?: RequestInit) => json(201, {}));
      const fetch = fakeGitHub(
        routes({
          [`POST ${R}/git/refs`]: () => json(422, { message: "Reference already exists" }),
          [`POST ${R}/pulls`]: pulls,
        }),
      );
      await expect(
        host(fetch).proposeFiles("albernhagen/andy-intelligence", proposal),
      ).rejects.toThrow(/already exists/);
      expect(pulls).not.toHaveBeenCalled();
    });

    it("GivenThePrFails_WhenProposed_ThenTheNewBranchIsDeletedAndItThrows", async () => {
      const del = vi.fn((_init?: RequestInit) => new Response(null, { status: 204 }));
      const fetch = fakeGitHub(
        routes({
          [`POST ${R}/pulls`]: () => json(500, { message: "boom" }),
          [`DELETE ${R}/git/refs/heads/baseline/abc1234`]: del,
        }),
      );
      await expect(
        host(fetch).proposeFiles("albernhagen/andy-intelligence", proposal),
      ).rejects.toThrow(/boom/);
      expect(del).toHaveBeenCalledOnce();
    });

    it("GivenAWorkflowPath_WhenProposed_ThenItThrowsWithoutCallingGitHub", async () => {
      const fetch = fakeGitHub(routes());
      await expect(
        host(fetch).proposeFiles("albernhagen/andy-intelligence", {
          ...proposal,
          files: [{ path: ".github/workflows/ci.yml", content: "x" }],
        }),
      ).rejects.toThrow();
      expect(fetch.mock.calls.some(([u]) => String(u).includes("/git/"))).toBe(false);
    });
  });

  describe("readRepoSetting", () => {
    const R = "/repos/albernhagen/andy-intelligence";

    it("GivenAReadableSetting_WhenRead_ThenItsStatusAndBodyComeBack", async () => {
      const fetch = fakeGitHub({
        ...installed,
        [`GET ${R}/rulesets`]: () => json(200, [{ id: 1, name: "protect-main" }]),
      });
      expect(
        await host(fetch).readRepoSetting(
          "albernhagen/andy-intelligence",
          "rulesets?includes_parents=false",
        ),
      ).toEqual({ status: 200, data: [{ id: 1, name: "protect-main" }] });
    });

    it("GivenARefusedRead_WhenRead_ThenTheStatusComesBackInsteadOfThrowing", async () => {
      const fetch = fakeGitHub({
        ...installed,
        [`GET ${R}/actions/permissions`]: () => json(403, { message: "Resource not accessible" }),
      });
      expect(
        await host(fetch).readRepoSetting("albernhagen/andy-intelligence", "actions/permissions"),
      ).toMatchObject({ status: 403 });
    });

    it.each(["../orgs/x", "/user", "a/../../b", "a?x=1#y", "a%2F..%2Fb", "%2e%2e/x"])(
      "GivenTheUnsafeSubpath%s_WhenRead_ThenItThrowsWithoutCallingGitHub",
      async (subpath) => {
        const fetch = fakeGitHub(installed);
        await expect(
          host(fetch).readRepoSetting("albernhagen/andy-intelligence", subpath),
        ).rejects.toThrow(/unsafe/);
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    it("GivenTheAppIsNotInstalled_WhenRead_ThenNull", async () => {
      const fetch = fakeGitHub({
        "GET /repos/albernhagen/other/installation": () => json(404, { message: "Not Found" }),
      });
      expect(await host(fetch).readRepoSetting("albernhagen/other", "")).toBeNull();
    });
  });
});
