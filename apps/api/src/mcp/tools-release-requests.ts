import { Project, type ReleaseRequest } from "@andy/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PromoteRequest, ReleaseRequestsQuery, RollbackRequest } from "../releases";
import type { Run, ToolDeps } from "./tools";

/**
 * MCP `promote`, `rollback` and `list_release_requests` (AI-199: M6.12, ADR-0160): the same
 * `ReleaseService` as `POST /api/projects/{id}/releases/promote|rollback` and
 * `GET …/releases/requests`. Owner only; one release request per project per minute.
 */

const ProjectKey = z
  .string()
  .transform((k) => k.trim().toUpperCase())
  .pipe(Project.shape.key)
  .describe('Project key, e.g. "AI". Call `status` with no ticket to list projects.');

const PromoteInput = { project: ProjectKey, digest: PromoteRequest.shape.digest };
const RollbackInput = {
  project: ProjectKey,
  environment: RollbackRequest.shape.environment,
  revision: RollbackRequest.shape.revision,
};
const ListInput = { project: ProjectKey, limit: ReleaseRequestsQuery.shape.limit };

/** One line per request, for the tool's first text block. */
export function renderReleaseRequestLine(r: ReleaseRequest): string {
  const what = r.action === "promote" ? r.digest.slice(0, 19) : `revision ${r.revision ?? "?"}`;
  const tail = [r.runUrl, r.error].filter(Boolean).join(" · ");
  return `- ${r.createdAt} ${r.action} ${r.environment} → ${what}: ${r.status}${tail ? ` · ${tail}` : ""}`;
}

export function registerReleaseRequestTools(
  server: McpServer,
  deps: Pick<ToolDeps, "releaseRequests" | "actor">,
  run: Run,
): void {
  const releases = deps.releaseRequests;
  if (!releases) return;
  const ACTION_NOTE =
    "Only Andy. Refused, with the reason, for a project whose deploy kind is none. At most one release request per project per minute. Starts the project's release.yml on main; the Releases page and list_releases show the new deployment once the workflow reports it, and list_release_requests shows the request's status (cancelled if a deploy took its place in the queue).";

  server.registerTool(
    "promote",
    {
      description: `Promotes to prod the image a dev deployment verified (dev-and-prod projects only; refused for prod-only): by default the latest succeeded dev deployment's digest, or the digest named. Answers the release request and what will serve. ${ACTION_NOTE}`,
      inputSchema: PromoteInput,
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    ({ project, digest }) =>
      run(() =>
        releases.promote(
          { projectId: project.toLowerCase(), ...(digest ? { digest } : {}) },
          deps.actor,
        ),
      ),
  );

  server.registerTool(
    "rollback",
    {
      description: `Rolls an environment (prod by default, or dev) back to an earlier succeeded deployment's revision: by default the newest succeeded revision before the one serving now, or the revision named. Answers the release request and what will serve. ${ACTION_NOTE}`,
      inputSchema: RollbackInput,
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    ({ project, environment, revision }) =>
      run(() =>
        releases.rollback(
          {
            projectId: project.toLowerCase(),
            ...(environment ? { environment } : {}),
            ...(revision ? { revision } : {}),
          },
          deps.actor,
        ),
      ),
  );

  server.registerTool(
    "list_release_requests",
    {
      description:
        "Lists a project's promote and rollback requests, newest first (default 20, at most 50): who asked, what will serve, the workflow run, and the status (requested, dispatched, started, succeeded, failed, cancelled, ended_unreported or dispatch_failed, with the reason). Read-only.",
      inputSchema: ListInput,
      annotations: { readOnlyHint: true },
    },
    async ({ project, limit }) => {
      const result = await run(async () => {
        const requests = await releases.list(project.toLowerCase(), limit);
        const head = `${project} release requests: ${requests.length}, newest first.`;
        return {
          requests,
          text: [head, ...requests.map(renderReleaseRequestLine)].join("\n"),
        };
      });
      const text = (result.structuredContent as { text?: unknown } | undefined)?.text;
      if (result.isError || typeof text !== "string") return result;
      return { ...result, content: [{ type: "text", text }, ...result.content] };
    },
  );
}
