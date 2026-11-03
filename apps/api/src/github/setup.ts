import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { Repo } from "@andy/contracts";
import { AppName, ManifestCode, appManifest, type CreatedApp } from "@andy/github";
import type { AuthEnv } from "../auth";
import type { GitHubConnection } from "./connection";

/**
 * GitHub App setup from the UI (ADR-0043), under /api (signed-in, allow-listed Andy only).
 * The SPA posts the manifest to GitHub itself and checks GitHub's `state` against the value it
 * kept in sessionStorage, so a forged callback link can't connect someone else's App.
 */

export const NEW_APP_URL = "https://github.com/settings/apps/new";

export interface SetupDeps {
  publicUrl: string;
  connection: GitHubConnection;
  exchangeCode: (code: string) => Promise<CreatedApp>;
  now: () => Date;
}

const ErrorBody = z.object({ error: z.string() });
const json = <S extends z.ZodType>(schema: S, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const secured = { security: [{ bearer: [] }] };

const GitHubStatus = z
  .object({
    connected: z.boolean(),
    slug: z.string().nullable(),
    owner: z.string().nullable(),
    /** Where Andy picks the repos the App is installed on. */
    installUrl: z.string().nullable(),
    repos: z.array(Repo),
  })
  .openapi("GitHubStatus");

const routes = {
  status: createRoute({
    ...secured,
    method: "get",
    path: "/api/github",
    responses: { 200: json(GitHubStatus, "Connection and installed repos") },
  }),
  manifest: createRoute({
    ...secured,
    method: "get",
    path: "/api/github/manifest",
    request: { query: z.object({ name: AppName.default("andy-intelligence") }) },
    responses: {
      200: json(
        z.object({ postUrl: z.string(), manifest: z.record(z.string(), z.unknown()) }),
        "App manifest to post to GitHub",
      ),
      409: json(ErrorBody, "Already connected"),
    },
  }),
  connect: createRoute({
    ...secured,
    method: "post",
    path: "/api/github/connect",
    request: {
      body: {
        content: { "application/json": { schema: z.object({ code: ManifestCode }) } },
        required: true,
      },
    },
    responses: {
      201: json(GitHubStatus, "Connected"),
      409: json(ErrorBody, "Already connected"),
      422: json(ErrorBody, "GitHub rejected the code"),
    },
  }),
};

function log(severity: "INFO" | "WARNING", message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ severity, message, component: "github-setup", ...fields }));
}

const installUrl = (slug: string) => `https://github.com/apps/${slug}/installations/new`;

export function registerGitHubSetup(app: OpenAPIHono<AuthEnv>, deps: SetupDeps): void {
  const status = async (): Promise<z.infer<typeof GitHubStatus>> => {
    const connection = await deps.connection.get();
    const host = await deps.connection.codeHost();
    if (!connection || !host) {
      return { connected: false, slug: null, owner: null, installUrl: null, repos: [] };
    }
    return {
      connected: true,
      slug: connection.slug,
      owner: connection.owner,
      installUrl: installUrl(connection.slug),
      repos: await host.listInstalledRepos(),
    };
  };

  app.openapi(routes.status, async (c) => c.json(await status(), 200));

  app.openapi(routes.manifest, async (c) => {
    if (await deps.connection.get()) return c.json({ error: "GitHub is already connected" }, 409);
    const manifest = appManifest(deps.publicUrl, c.req.valid("query").name);
    return c.json({ postUrl: NEW_APP_URL, manifest }, 200);
  });

  app.openapi(routes.connect, async (c) => {
    deps.connection.invalidate();
    if (await deps.connection.get()) return c.json({ error: "GitHub is already connected" }, 409);
    let created: CreatedApp;
    try {
      created = await deps.exchangeCode(c.req.valid("json").code);
    } catch (err) {
      log("WARNING", "manifest code exchange failed", {
        status: (err as { status?: number }).status,
      });
      return c.json(
        { error: "GitHub rejected the code; it is single-use and expires in an hour" },
        422,
      );
    }
    const result = await deps.connection.store.save({
      ...created,
      connectedAt: deps.now().toISOString(),
    });
    deps.connection.invalidate();
    if (result === "exists") return c.json({ error: "GitHub is already connected" }, 409);
    log("INFO", "github app connected", { appId: created.appId, slug: created.slug });
    return c.json(await status(), 201);
  });
}
