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
function fakeGitHub(routes: Record<string, () => Response>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const route = routes[`${init?.method ?? "GET"} ${url.pathname}`];
    return route ? route() : json(500, { message: `unexpected ${url.pathname}` });
  });
}

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
  new GitHubCodeHost({ appId: "1", privateKey }, fetch);

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
});
