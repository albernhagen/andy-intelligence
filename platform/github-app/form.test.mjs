import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APPS, manifestForm } from "./form.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (app) => JSON.parse(readFileSync(path.join(HERE, `${app}.json`), "utf8"));

describe("GitHub App manifests", () => {
  it("GivenEachManifest_WhenRead_ThenItIsPrivateAndRedirectsToADeadLocalPage", () => {
    for (const app of APPS) {
      const m = load(app);
      expect(m.public).toBe(false);
      expect(m.redirect_url).toBe("http://localhost:1/");
      expect(m.default_permissions.metadata).toBe("read");
    }
  });

  it("GivenTheControlPlaneApp_WhenRead_ThenItIsReadOnlyAndSendsTheRecordedEvents", () => {
    const m = load("control-plane");
    expect(Object.values(m.default_permissions)).toEqual(
      Object.values(m.default_permissions).map(() => "read"),
    );
    expect(m.hook_attributes.url).toMatch(/^https:\/\/.+\/webhooks\/github$/);
    expect(m.default_events.sort()).toEqual(["check_run", "pull_request", "workflow_run"]);
  });

  it("GivenTheReviewBot_WhenRead_ThenItHasNoWebhookAndOnlyContentsAndPrWrite", () => {
    const m = load("review-bot");
    expect(m.hook_attributes).toBeUndefined();
    expect(m.default_permissions).toEqual({
      metadata: "read",
      contents: "write",
      pull_requests: "write",
    });
  });
});

describe("manifestForm", () => {
  it("GivenAManifest_WhenRendered_ThenItPostsTheEscapedJsonToGitHub", () => {
    const html = manifestForm({ name: 'a"<b>' }, "s1");
    expect(html).toContain('action="https://github.com/settings/apps/new?state=s1"');
    expect(html).toContain('value="{&quot;name&quot;:&quot;a\\&quot;&lt;b&gt;&quot;}"');
    expect(html).not.toContain('<b>"');
  });
});
