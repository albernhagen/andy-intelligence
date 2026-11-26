import type { Page } from "@playwright/test";
import type { Project, ReleaseListItem, ReleaseListing } from "@andy/contracts";

/**
 * AI-189: M6.10: Releases screen. The fake API (e2e/fake-api.ts) has no GitHub, so a release
 * could not be compared; these fixed listings are served instead, and project AI reads as a
 * `cloud-run`, `dev-and-prod` project for this screen only (other screens keep the seed).
 */

const PROJECT = "ai";
const REPO = "albernhagen/andy-intelligence";
const sha = (c: string) => c.repeat(40);

function item(
  env: "prod" | "dev",
  n: number,
  o: Partial<ReleaseListItem["deployment"]>,
  release: Partial<ReleaseListItem["release"]> = {},
  tickets: ReleaseListItem["tickets"] = [],
): ReleaseListItem {
  const id = `${env}-${n}`;
  const startedAt = new Date(Date.parse("2026-11-04T09:00:00.000Z") + n * 3_600_000).toISOString();
  const finishedAt = new Date(Date.parse(startedAt) + 4 * 60_000).toISOString();
  const deployment = {
    id,
    projectId: PROJECT,
    environment: env,
    imageDigest: `sha256:${String(n).repeat(64).slice(0, 64)}`,
    gitSha: sha(String(n % 10)),
    revision: `control-plane-${env === "dev" ? "dev-" : ""}0004${n}`,
    kind: "deploy" as const,
    status: "succeeded" as const,
    startedAt,
    finishedAt,
    actor: "system",
    previousDeploymentId: null,
    url: `https://${env === "dev" ? "dev." : ""}ai.example.com`,
    request: null,
    verification: null,
    ...o,
  };
  return {
    deployment,
    tickets,
    release: {
      projectId: PROJECT,
      environment: env,
      deploymentId: id,
      gitSha: deployment.gitSha,
      previous: null,
      status: "first",
      reason: null,
      entries: [],
      groups: [],
      truncated: false,
      ...release,
    },
  };
}

const line = (n: number, text: string, noNote = false) => ({
  prNumber: n,
  prUrl: `https://github.com/${REPO}/pull/${n}`,
  sha: sha(String(n % 10)),
  text,
  noNote,
});

const PROD: ReleaseListItem[] = [
  item(
    "prod",
    3,
    { kind: "promote", actor: "user:andy" },
    {
      status: "listed",
      previous: { deploymentId: "prod-2", gitSha: sha("2") },
      groups: [
        {
          epicKey: "AI-153",
          epicTitle: "M6: Dev → prod releases",
          lines: [
            line(447, "Andy can list each environment's releases over the API and MCP."),
            line(452, "Promote and rollback from the Releases page, with a confirm step."),
          ],
        },
        { epicKey: null, epicTitle: null, lines: [line(449, "Logo in the header", true)] },
      ],
    },
    [
      { key: "AI-183", title: "M6.9: Releases API and MCP", epicKey: "AI-153" },
      { key: "AI-199", title: "M6.12: Promote and rollback", epicKey: "AI-153" },
    ],
  ),
  item("prod", 2, { kind: "rollback", actor: "user:andy" }, { status: "not_ahead" }),
  item("prod", 1, {}),
];

const DEV: ReleaseListItem[] = [
  item("dev", 5, { status: "started", finishedAt: null, revision: null, actor: "agent:run-1" }),
  item("dev", 4, { status: "failed" }, { status: "same_commit" }),
  item("dev", 3, {}),
];

export async function mockReleases(page: Page) {
  await page.route("**/api/projects", async (route) => {
    const response = await route.fetch();
    const projects = (await response.json()) as Project[];
    await route.fulfill({
      response,
      json: projects.map((p) =>
        p.id === PROJECT ? { ...p, deployKind: "cloud-run", environments: "dev-and-prod" } : p,
      ),
    });
  });
  await page.route(`**/api/projects/${PROJECT}/releases?*`, (route) => {
    const env = new URL(route.request().url()).searchParams.get("env") === "dev" ? "dev" : "prod";
    const listing: ReleaseListing = {
      projectId: PROJECT,
      environment: env,
      items: env === "dev" ? DEV : PROD,
    };
    return route.fulfill({ json: listing });
  });
  await page.route(`**/api/projects/${PROJECT}/releases/requests*`, (route) =>
    route.fulfill({ json: { requests: [] } }),
  );
}
