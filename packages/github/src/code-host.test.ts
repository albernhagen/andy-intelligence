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
    const route = routes[`${init?.method ?? "GET"} ${url.pathname}`];
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
});
