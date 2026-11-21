import { Project, Route, ROUTING_LIMITS, TierKey, type RoutingConfig } from "@andy/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ToolDeps } from "./tools";

const ProjectKey = z
  .string()
  .transform((k) => k.trim().toUpperCase())
  .pipe(Project.shape.key)
  .describe('Project key, e.g. "AI". Omit for the global routing.');

/** What a client needs of a config: providers, each tier's routes, each step's tier. */
const view = (c: RoutingConfig) => ({
  scope: c.scope,
  providers: c.providers,
  tiers: c.tiers,
  steps: c.steps,
  updatedAt: c.updatedAt,
});

/**
 * Model routing over MCP (AI-239: M9.7): the same RoutingSettings rules as the REST routes.
 * `set_tier_routes` is owner-only, checks every route's compatibility and, for a project, that it
 * only narrows global; each save is logged as a ConfigChange.
 */
export function registerRoutingTools(
  server: McpServer,
  deps: Pick<ToolDeps, "routing" | "actor">,
  run: <T extends object>(fn: () => Promise<T>) => Promise<CallToolResult>,
): void {
  const routing = deps.routing;
  if (!routing) return;

  server.registerTool(
    "get_routing",
    {
      description:
        "Model routing: which providers are on (with reserve, warn and pause levels), each tier's routes in order (harness, provider, model; the first usable one runs), and which tier each step uses (`by_size`: the ticket's tier). Without a project: the global routing. With one: also the project's own config (null when it follows global) and the effective one.",
      inputSchema: { project: ProjectKey.optional() },
      annotations: { readOnlyHint: true },
    },
    ({ project }) =>
      run(async () => {
        const global = view(await routing.global());
        if (!project) return { global };
        const p = await routing.project(project.toLowerCase());
        return {
          global,
          project: {
            key: project,
            config: p.config && view(p.config),
            effective: view(p.effective),
          },
        };
      }),
  );

  server.registerTool(
    "set_tier_routes",
    {
      description: `Replaces one tier's routes, first choice first (at most ${ROUTING_LIMITS.routesPerTier}), as Andy (owner only). Global without a project; with one, the project's config (started from global when it has none), which may only use routes global lists for that tier. Refused with the reason when a route can't run (claude-code needs claude-sub and a Claude model; jules needs google-sub; opencode and direct need openrouter). Logged as a settings change.`,
      inputSchema: {
        project: ProjectKey.optional(),
        tier: TierKey,
        routes: z.array(Route).min(1).max(ROUTING_LIMITS.routesPerTier),
        reason: z.string().max(500).optional().describe("Why, shown in the change log."),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ project, tier, routes, reason }) =>
      run(async () =>
        view(
          await routing.setTierRoutes(
            project ? project.toLowerCase() : null,
            tier,
            routes,
            deps.actor,
            reason,
          ),
        ),
      ),
  );
}
