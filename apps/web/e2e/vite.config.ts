import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import type { IncomingMessage } from "node:http";

type FetchApp = { fetch(request: Request): Response | Promise<Response> };

/**
 * Dev server for the Playwright screenshot checks only: e2e/index.html (no Firebase) plus the
 * real API over seeded fakes on `/api/*`, in the same process. Never built or deployed.
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss(), fakeApi()],
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  server: { host: "127.0.0.1" },
});

function fakeApi(): Plugin {
  return {
    name: "fake-api",
    configureServer(server: ViteDevServer) {
      let app: Promise<FetchApp> | undefined;
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        // Loaded through Vite so the workspace packages' TypeScript sources just work.
        app ??= server
          .ssrLoadModule("/fake-api.ts")
          .then((m) => (m as { createFakeApp(): Promise<FetchApp> }).createFakeApp());
        void (async () => {
          const response = await (await app).fetch(await toRequest(req));
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        })().catch(next);
      });
    },
  };
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers))
    if (typeof value === "string") headers.set(key, value);
  const chunks: Buffer[] = [];
  if (req.method !== "GET" && req.method !== "HEAD") for await (const c of req) chunks.push(c);
  return new Request(new URL(req.url!, "http://127.0.0.1"), {
    method: req.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
}
