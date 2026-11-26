import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { DeploymentRelease, NewDeployment } from "@andy/contracts";
import { buildReleaseNote } from "@andy/domain";
import { actorText } from "@/components/releases/DeploymentRow";
import { DEPLOY_RUNBOOK } from "@/components/releases/EnvironmentReleases";
import { ReleaseNotes } from "@/components/releases/ReleaseNotes";
import { renderApp } from "@/test/harness";

/** AI-189: M6.10: the Releases page over the real releases API (AI-183: M6.9). */

const REPO = "albernhagen/andy-intelligence";
const sha = (c: string) => c.repeat(40);
const digest = (c: string) => `sha256:${c.repeat(64)}`;

async function open(
  settings: { deployKind: "cloud-run" | "none"; environments: "prod-only" | "dev-and-prod" },
  seed = true,
) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const h = renderApp("/p/ai/releases", { githubConnected: true });
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI", repos: [REPO] });
  await h.tracker.updateProject("ai", settings);
  if (seed) {
    const story = await h.tracker.createTicket(
      "ai",
      { type: "feature", title: "Releases page" },
      "andy",
    );
    await h.releaseNotes.put(
      buildReleaseNote({
        projectId: "ai",
        pr: { number: 7, url: `https://github.com/${REPO}/pull/7`, title: "Releases page" },
        details: {
          body: "What changed: Andy sees each environment's deployments.\nHow it works: A page.",
          mergedBy: null,
          mergedAt: "2026-11-26T10:30:00.000Z",
        },
        ticket: { key: story.key, title: story.title, risk: null },
        files: [],
        recordedAt: "2026-11-26T10:30:00.000Z",
      }),
    );
    const deploy = (o: Partial<NewDeployment>) =>
      h.deployments.record({
        projectId: "ai",
        environment: "prod",
        imageDigest: digest("a"),
        gitSha: sha("a"),
        kind: "deploy",
        status: "succeeded",
        startedAt: "2026-11-26T10:00:00.000Z",
        finishedAt: "2026-11-26T10:05:00.000Z",
        actor: "system",
        ...o,
      });
    await deploy({ revision: "web-00001" });
    await deploy({
      revision: "web-00002",
      gitSha: sha("b"),
      imageDigest: digest("b"),
      startedAt: "2026-11-26T11:00:00.000Z",
      finishedAt: "2026-11-26T11:05:00.000Z",
      actor: "user:andy",
      url: "https://web.example.com",
    });
    await deploy({ environment: "dev", revision: "web-dev-00009", gitSha: sha("b") });
    h.codeHost.commitRanges.set(`${sha("a")}...${sha("b")}`, {
      status: "ahead",
      commits: { items: [{ sha: sha("c"), title: "Releases page (#7)" }], complete: true },
    });
  }
  await h.queryClient.invalidateQueries();
  return h;
}

const column = async (env: string) => screen.findByRole("region", { name: env });

describe("Releases page", () => {
  it("GivenDevAndProdDeployments_WhenThePageOpens_ThenEachEnvironmentListsItsDeploymentsNewestFirst", async () => {
    await open({ deployKind: "cloud-run", environments: "dev-and-prod" });

    expect(await screen.findByRole("heading", { name: "Releases" })).toBeTruthy();
    const prod = await column("prod");
    await within(prod).findByText("web-00002");
    const rows = within(prod).getAllByRole("button", { expanded: false });
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Succeeded.*web-00002.*Andy · 1 ticket/),
      expect.stringMatching(/Succeeded.*web-00001.*the deploy workflow/),
    ]);
    expect(await within(await column("dev")).findByText("web-dev-00009")).toBeTruthy();
    // AI-199: M6.12's actions sit above the columns.
    expect(screen.getByRole("region", { name: "Promote and rollback" })).toBeTruthy();
  });

  it("GivenAListedDeployment_WhenItIsExpanded_ThenItsReleaseNotesTicketsAndLinksShow", async () => {
    const h = await open({ deployKind: "cloud-run", environments: "prod-only" });
    const prod = await column("prod");
    await h.user.click(await within(prod).findByRole("button", { name: /web-00002/ }));

    expect(await within(prod).findByText("Andy sees each environment's deployments.")).toBeTruthy();
    expect(within(prod).getByRole("link", { name: "PR #7" }).getAttribute("href")).toBe(
      `https://github.com/${REPO}/pull/7`,
    );
    expect(within(prod).getByRole("link", { name: "AI-1: Releases page" })).toBeTruthy();
    expect(within(prod).getByRole("link", { name: "Open prod" }).getAttribute("href")).toBe(
      "https://web.example.com",
    );
    expect(within(prod).getByRole("link", { name: "Commit bbbbbbb" }).getAttribute("href")).toBe(
      `https://github.com/${REPO}/commit/${sha("b")}`,
    );
    expect(screen.queryByRole("region", { name: "dev" })).toBeNull();
  });

  it("GivenTheFirstDeployment_WhenItIsExpanded_ThenItSaysThereIsNothingToCompare", async () => {
    const h = await open({ deployKind: "cloud-run", environments: "prod-only" });
    const prod = await column("prod");
    await h.user.click(await within(prod).findByRole("button", { name: /web-00001/ }));
    expect(
      await within(prod).findByText("First deployment to prod: nothing earlier to compare with."),
    ).toBeTruthy();
  });

  it("GivenACloudRunProjectWithNoDeployments_WhenThePageOpens_ThenItSaysSoAndLinksTheRunbook", async () => {
    await open({ deployKind: "cloud-run", environments: "prod-only" }, false);
    const prod = await column("prod");
    expect(await within(prod).findByText("No deployments to prod yet.")).toBeTruthy();
    expect(within(prod).getByRole("link", { name: "Deploy runbook" }).getAttribute("href")).toBe(
      DEPLOY_RUNBOOK,
    );
  });

  it("GivenDeployKindNone_WhenThePageOpens_ThenItSaysTheProjectDoesNotDeploy", async () => {
    await open({ deployKind: "none", environments: "prod-only" }, false);
    expect(await screen.findByText("This project doesn't deploy.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Deploy runbook" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Promote and rollback" })).toBeNull();
  });

  it("GivenWhatsNew_WhenReleasesIsClicked_ThenTheReleasesPageOpensUnderWhatsNew", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const h = renderApp("/p/ai/whats-new");
    await h.tracker.createProject({ name: "Andy Intelligence", key: "AI", repos: [REPO] });
    await h.queryClient.invalidateQueries();
    await h.user.click(await screen.findByRole("link", { name: "Releases" }));
    expect(await screen.findByText("This project doesn't deploy.")).toBeTruthy();
    expect(h.router.state.location.pathname).toBe("/p/ai/releases");
  });
});

describe("ReleaseNotes", () => {
  const release = (o: Partial<DeploymentRelease>): DeploymentRelease => ({
    projectId: "ai",
    environment: "prod",
    deploymentId: "d1",
    gitSha: sha("b"),
    previous: null,
    status: "listed",
    reason: null,
    entries: [],
    groups: [],
    truncated: false,
    ...o,
  });

  it("GivenUnavailableNotes_WhenShown_ThenTheReasonIsSaid", () => {
    render(<ReleaseNotes release={release({ status: "unavailable", reason: "no GitHub" })} />);
    expect(screen.getByText("Release notes unavailable: no GitHub.")).toBeTruthy();
  });

  it("GivenARollback_WhenShown_ThenNothingNewShips", () => {
    render(<ReleaseNotes release={release({ status: "not_ahead" })} />);
    expect(screen.getByText(/a rollback\): nothing new ships/)).toBeTruthy();
  });

  it("GivenLinesWithAndWithoutAnEpic_WhenShown_ThenTheyAreGroupedAndMarked", () => {
    render(
      <ReleaseNotes
        release={release({
          truncated: true,
          groups: [
            {
              epicKey: "AI-153",
              epicTitle: "M6: Dev → prod releases",
              lines: [{ prNumber: 9, prUrl: null, sha: sha("d"), text: "Fix", noNote: true }],
            },
            {
              epicKey: null,
              epicTitle: null,
              lines: [{ prNumber: null, prUrl: null, sha: sha("e"), text: "Hotfix", noNote: true }],
            },
          ],
        })}
      />,
    );
    const epic = screen.getByRole("region", { name: "AI-153: M6: Dev → prod releases" });
    expect(within(epic).getByText("no note")).toBeTruthy();
    const none = screen.getByRole("region", { name: "No epic" });
    expect(within(none).getByText("no PR")).toBeTruthy();
    expect(screen.getByText(/first 100 commits/)).toBeTruthy();
  });
});

describe("actorText", () => {
  it("GivenEachActorKind_WhenNamed_ThenItReadsAsWords", () => {
    expect(["user:u1", "agent:r1", "system", "other"].map(actorText)).toEqual([
      "Andy",
      "an agent task",
      "the deploy workflow",
      "other",
    ]);
  });
});
