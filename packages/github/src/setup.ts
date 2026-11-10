import { Octokit } from "@octokit/core";
import { z } from "zod";

/**
 * GitHub App setup through the manifest flow (ADR-0043). The UI posts `appManifest(...)` to
 * GitHub; Andy clicks Create; GitHub redirects back with a one-hour, single-use code that
 * `exchangeManifestCode` turns into the App's identifiers, private key and webhook secret.
 */

/** Permissions the control-plane App asks for. Contents/PR write: PRs from CI (token endpoint). */
export const APP_PERMISSIONS = {
  metadata: "read",
  contents: "write",
  pull_requests: "write",
  checks: "read",
  // Write: the control plane dispatches agent runs (M1.6a: Claude Code executor).
  actions: "write",
} as const;

/**
 * Webhook events (installation events are always sent to Apps). `push` (AI-72): the default
 * branch moving queues sync runs; an App made before it needs the event ticked by hand
 * (runbook agent-runs.md).
 */
export const APP_EVENTS = ["pull_request", "check_run", "workflow_run", "push"] as const;

/**
 * Suggested App name. App names are global on GitHub and can't match an existing account
 * ("andy-intelligence" is taken), so the UI lets Andy change it.
 */
export const DEFAULT_APP_NAME = "andy-intelligence-control";

/** GitHub App names: up to 34 characters (letters, digits, spaces, `-`, `_`, `.`). */
export const AppName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,33}$/);

export function appManifest(publicUrl: string, name: string) {
  return {
    name: AppName.parse(name),
    description: "andy-intelligence control plane (ADR-0043)",
    url: publicUrl,
    hook_attributes: { url: `${publicUrl}/webhooks/github`, active: true },
    redirect_url: `${publicUrl}/settings/github/callback`,
    setup_url: `${publicUrl}/settings/github`,
    setup_on_update: true,
    public: false,
    default_permissions: APP_PERMISSIONS,
    default_events: [...APP_EVENTS],
  };
}

/** The manifest code GitHub appends to the redirect URL. */
export const ManifestCode = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

const Conversion = z.object({
  id: z.number(),
  slug: z.string(),
  client_id: z.string(),
  pem: z.string(),
  webhook_secret: z.string().min(1),
  owner: z.object({ login: z.string() }),
});

export interface CreatedApp {
  appId: string;
  slug: string;
  clientId: string;
  owner: string;
  privateKey: string;
  webhookSecret: string;
}

/** Single use: GitHub rejects a code it has already converted (404/422). */
export async function exchangeManifestCode(
  code: string,
  fetchImpl?: typeof fetch,
): Promise<CreatedApp> {
  const octokit = new Octokit({
    request: { ...(fetchImpl ? { fetch: fetchImpl } : {}), timeout: 10_000 },
  });
  const res = await octokit.request("POST /app-manifests/{code}/conversions", {
    code: ManifestCode.parse(code),
  });
  const app = Conversion.parse(res.data);
  return {
    appId: String(app.id),
    slug: app.slug,
    clientId: app.client_id,
    owner: app.owner.login,
    privateKey: app.pem,
    webhookSecret: app.webhook_secret,
  };
}
