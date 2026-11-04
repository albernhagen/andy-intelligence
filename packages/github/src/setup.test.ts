import { describe, expect, it, vi } from "vitest";
import { APP_PERMISSIONS, appManifest, exchangeManifestCode } from "./setup";

const URL_ = "https://control-plane.example.run.app";

describe("appManifest", () => {
  it("GivenThePublicUrl_WhenBuilt_ThenHooksAndRedirectsPointAtThisService", () => {
    const m = appManifest(URL_, "andy-intelligence");
    expect(m.hook_attributes).toEqual({ url: `${URL_}/webhooks/github`, active: true });
    expect(m.redirect_url).toBe(`${URL_}/settings/github/callback`);
    expect(m.setup_url).toBe(`${URL_}/settings/github`);
    expect(m.public).toBe(false);
    expect(m.default_events.sort()).toEqual(["check_run", "pull_request", "workflow_run"]);
  });

  it("GivenTheApp_WhenBuilt_ThenItCanNotEditWorkflowsOrAdministerRepos", () => {
    expect(APP_PERMISSIONS).toEqual({
      metadata: "read",
      contents: "write",
      pull_requests: "write",
      checks: "read",
      actions: "write",
    });
  });

  it("GivenABadName_WhenBuilt_ThenItThrows", () => {
    expect(() => appManifest(URL_, "<script>")).toThrow();
    expect(() => appManifest(URL_, "x".repeat(35))).toThrow();
  });
});

describe("exchangeManifestCode", () => {
  it("GivenACode_WhenExchanged_ThenTheAppAndItsSecretsAreReturned", async () => {
    const fetch = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            id: 42,
            slug: "andy-intelligence",
            client_id: "Iv23x",
            pem: "PEM",
            webhook_secret: "whs",
            owner: { login: "albernhagen" },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
    );
    expect(await exchangeManifestCode("abc123", fetch)).toEqual({
      appId: "42",
      slug: "andy-intelligence",
      clientId: "Iv23x",
      owner: "albernhagen",
      privateKey: "PEM",
      webhookSecret: "whs",
    });
    expect(String(fetch.mock.calls[0]![0])).toBe(
      "https://api.github.com/app-manifests/abc123/conversions",
    );
  });

  it("GivenAMalformedCode_WhenExchanged_ThenItThrowsWithoutCallingGitHub", async () => {
    const fetch = vi.fn();
    await expect(exchangeManifestCode("../x", fetch)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
