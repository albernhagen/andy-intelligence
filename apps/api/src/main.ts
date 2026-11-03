import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  FirestoreCodeEventLog,
  GcpCodeHostConnectionStore,
  SecretManagerVersions,
  FirestoreOAuthGrantStore,
  FirestoreWorkTracker,
  createFirestore,
} from "@andy/store";
import { createApp } from "./app";
import { parseAllowList } from "./auth";
import { firebaseVerifier } from "./firebase";
import { ClientMetadataResolver } from "./mcp";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

async function main() {
  const projectId = requireEnv("GCP_PROJECT_ID");
  const allowedEmails = parseAllowList(requireEnv("ALLOWED_EMAILS"));
  const port = Number(process.env.PORT ?? 8080);
  const db = createFirestore(projectId);
  // MCP is on only when the public URL is set (it is the OAuth issuer and resource).
  const publicUrl = process.env.PUBLIC_URL?.replace(/\/+$/, "");

  const app = createApp({
    verifier: firebaseVerifier(projectId),
    allowedEmails,
    version: process.env.K_REVISION ?? "dev",
    webConfig: {
      firebaseApiKey: requireEnv("FIREBASE_API_KEY"),
      firebaseAuthDomain: requireEnv("FIREBASE_AUTH_DOMAIN"),
      projectId,
    },
    tracker: new FirestoreWorkTracker(db),
    // Serve only the public URL's host; the run.app URLs answer /health alone (ADR-0044).
    publicHost: publicUrl ? new URL(publicUrl).host : undefined,
    mcp: publicUrl
      ? {
          publicUrl,
          grants: new FirestoreOAuthGrantStore(db),
          clients: new ClientMetadataResolver(),
        }
      : undefined,
    // GitHub App (ADR-0043): connected from the UI; needs the public URL for its manifest.
    github: publicUrl
      ? {
          publicUrl,
          connections: new GcpCodeHostConnectionStore(db, new SecretManagerVersions(projectId)),
          events: new FirestoreCodeEventLog(db),
        }
      : undefined,
  });

  // SPA: serve built web assets; unknown non-API paths fall back to index.html.
  const webRoot = process.env.WEB_ROOT ?? "./public";
  app.use("/*", serveStatic({ root: webRoot }));
  app.get("*", serveStatic({ root: webRoot, path: "index.html" }));

  serve({ fetch: app.fetch, port }, (info) =>
    console.log(JSON.stringify({ severity: "INFO", message: `listening on ${info.port}` })),
  );
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ severity: "ERROR", message: String(err) }));
  process.exit(1);
});
