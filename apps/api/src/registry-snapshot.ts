import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as contracts from "@andy/contracts";
import * as contractsTesting from "@andy/contracts/testing";
import * as domain from "@andy/domain";
import * as store from "@andy/store";
import { createApp, type AppDeps } from "./app";
import { ClientMetadataResolver } from "./mcp";
import { ownerOnlyAccess } from "./project-access";
import { mcpToolNames } from "./mcp/test-client";

const PUBLIC_URL = "http://localhost";

/** The app with every optional feature on, fakes only (no network, no credentials). */
export function fullApp(overrides: Partial<AppDeps> = {}) {
  const grants = new contracts.InMemoryOAuthGrantStore();
  const app = createApp(fullAppDeps(grants, overrides));
  return { app, grants };
}

/** `fullApp`'s deps: every optional feature on, fakes only; `overrides` replace fields. */
export function fullAppDeps(
  grants = new contracts.InMemoryOAuthGrantStore(),
  overrides: Partial<AppDeps> = {},
): AppDeps {
  return {
    projectAccess: ownerOnlyAccess(),
    verifier: { verify: () => Promise.reject(new Error("unused")) },
    allowedEmails: new Set(["andy@example.com"]),
    version: "snapshot",
    webConfig: { firebaseApiKey: "", firebaseAuthDomain: "", projectId: "" },
    tracker: new contracts.InMemoryWorkTracker(),
    runs: new contracts.InMemoryRunStore(),
    runners: new contracts.InMemoryRunnerStore(),
    configChanges: new contracts.InMemoryConfigChangeStore(),
    reviewFindings: new contracts.InMemoryReviewFindingSource(),
    quota: new contracts.InMemoryQuotaStore(),
    nightLaunches: new contracts.InMemoryNightLaunchStore(),
    routing: new contracts.InMemoryRoutingConfigStore(),
    milestones: new contracts.InMemoryMilestoneStore(),
    epicBreakdowns: new contracts.InMemoryEpicBreakdownStore(),
    releaseNotes: new contracts.InMemoryReleaseNoteStore(),
    digestSummaries: new contracts.InMemoryDigestSummaryStore(),
    projectVersions: new contracts.InMemoryProjectVersions(),
    publicHost: "localhost",
    watchdog: {
      queue: new contracts.InMemoryWatchdogQueue(),
      publicUrl: PUBLIC_URL,
      invokerEmail: "invoker@example.com",
      verifyInvokerToken: () => Promise.reject(new Error("unused")),
    },
    mcp: {
      publicUrl: PUBLIC_URL,
      grants,
      clients: new ClientMetadataResolver({ fetch: (() => Promise.reject()) as typeof fetch }),
    },
    email: {
      ledger: new contracts.InMemoryNotifyLedger(),
      notifier: { notify: () => Promise.resolve() },
      flushQueue: new contracts.InMemoryNotifyFlushQueue(),
      appUrl: PUBLIC_URL,
    },
    github: {
      publicUrl: PUBLIC_URL,
      connections: new contracts.InMemoryCodeHostConnectionStore(),
      events: new contracts.InMemoryCodeEventLog(),
    },
    ...overrides,
  };
}

/**
 * What the API exposes with every feature on: routes and middleware in registration order (Hono
 * runs them in that order), the OpenAPI document, MCP tool names, and each package's public
 * exports. Compare two checkouts' output to prove a refactor changed none of it:
 * `pnpm --filter @andy/api snapshot > before.json` (AI-145).
 */
export async function registrySnapshot() {
  const { app, grants } = fullApp();
  const keys = (m: object) => Object.keys(m).sort();
  const openapi = await (await app.request("http://localhost/openapi.json")).json();
  return {
    routes: app.routes.map((r) => `${r.method} ${r.path}`),
    // The OpenAPI document with keys sorted, so only content counts, not registration order.
    openapiSha256: createHash("sha256")
      .update(JSON.stringify(sortKeys(openapi)))
      .digest("hex"),
    tools: (await mcpToolNames(app, grants, `${PUBLIC_URL}/mcp`)).sort(),
    exports: {
      "@andy/contracts": keys(contracts),
      "@andy/contracts/testing": keys(contractsTesting),
      "@andy/domain": keys(domain),
      "@andy/store": keys(store),
    },
  };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await registrySnapshot(), null, 2));
}
