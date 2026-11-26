import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { NewDeployment } from "@andy/contracts";
import { renderApp } from "@/test/harness";
import { ReleaseActions } from "./ReleaseActions";

/** AI-199: M6.12: promote and rollback buttons with a confirm step, against the real API. */

const REPO = "albernhagen/andy-intelligence";
const digest = (c: string) => `sha256:${c.repeat(64)}`;

async function open(
  environments: "prod-only" | "dev-and-prod" = "dev-and-prod",
  deployKind: "cloud-run" | "none" = "cloud-run",
) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const h = renderApp("/", {
    githubConnected: true,
    ui: <ReleaseActions projectId="ai" deployKind={deployKind} environments={environments} />,
  });
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI", repos: [REPO] });
  await h.tracker.updateProject("ai", { deployKind, environments });
  let minute = 0;
  const deploy = (overrides: Partial<NewDeployment>) => {
    minute += 1;
    const at = new Date(Date.parse("2026-11-26T09:00:00.000Z") + minute * 60_000).toISOString();
    return h.deployments.record({
      projectId: "ai",
      environment: "prod",
      imageDigest: digest("a"),
      gitSha: "a".repeat(40),
      kind: "deploy",
      status: "succeeded",
      startedAt: at,
      finishedAt: at,
      actor: "system",
      ...overrides,
    });
  };
  await deploy({ environment: "dev", imageDigest: digest("b"), gitSha: "b".repeat(40) });
  await deploy({ revision: "control-plane-00001" });
  await deploy({ revision: "control-plane-00002", imageDigest: digest("c") });
  await h.queryClient.invalidateQueries();
  return h;
}

const button = (name: string) => screen.findByRole("button", { name });
const enabled = async (name: string) => {
  const b = await button(name);
  await waitFor(() => expect((b as HTMLButtonElement).disabled).toBe(false));
  return b;
};

describe("ReleaseActions", () => {
  it("GivenADevAndProdProject_WhenPromoteIsConfirmed_ThenTheDialogNamesWhatWillServeAndReleaseYmlStarts", async () => {
    const h = await open();
    await h.user.click(await enabled("Promote to prod"));

    const dialog = await screen.findByRole("dialog", { name: "Promote to prod?" });
    expect(
      within(dialog).getByText(/prod will serve sha256:bbbbbbbbbbbb \(commit bbbbbbb\)/),
    ).toBeTruthy();
    expect(h.codeHost.workflowRuns.size).toBe(0);

    await h.user.click(within(dialog).getByRole("button", { name: "Promote" }));
    expect(await screen.findByText(/^Requested: prod will serve sha256:bbbbbbbbbbbb/)).toBeTruthy();
    const [run] = [...h.codeHost.workflowRuns.values()];
    expect(run?.inputs).toMatchObject({ action: "promote", digest: digest("b") });
    const list = await screen.findByRole("list", { name: "Release requests" });
    expect(within(list).getByText(/Promote prod → sha256:bbbbbbbbbbbb: waiting/)).toBeTruthy();
  });

  it("GivenTheRollbackDialog_WhenCancelled_ThenNothingStarts", async () => {
    const h = await open();
    await h.user.click(await enabled("Roll back prod"));
    const dialog = await screen.findByRole("dialog", { name: "Roll back prod?" });
    expect(
      within(dialog).getByText(
        /prod will serve revision control-plane-00001 \(commit aaaaaaa\) again/,
      ),
    ).toBeTruthy();
    await h.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.codeHost.workflowRuns.size).toBe(0);
  });

  it("GivenARollbackJustAsked_WhenAnotherIsConfirmedWithinAMinute_ThenItSaysWhyNotStarted", async () => {
    const h = await open();
    await h.user.click(await enabled("Roll back prod"));
    await h.user.click(await screen.findByRole("button", { name: "Roll back" }));
    await screen.findByText(/^Requested:/);
    await h.user.click(await enabled("Roll back prod"));
    await h.user.click(await screen.findByRole("button", { name: "Roll back" }));
    expect(await screen.findByText(/^Not started: one release request per project/)).toBeTruthy();
    expect(h.codeHost.workflowRuns.size).toBe(1);
  });

  it("GivenAProdOnlyProject_WhenRendered_ThenOnlyRollbackIsOffered", async () => {
    await open("prod-only");
    await enabled("Roll back prod");
    expect(screen.queryByRole("button", { name: "Promote to prod" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Roll back dev" })).toBeNull();
  });

  it("GivenNoEarlierDevRevision_WhenRendered_ThenRollBackDevIsDisabledWithTheReason", async () => {
    await open();
    const dev = await button("Roll back dev");
    await waitFor(() =>
      expect(dev.getAttribute("title")).toBe("nothing has succeeded in dev with a known revision"),
    );
    expect((dev as HTMLButtonElement).disabled).toBe(true);
  });

  it("GivenDeployKindNone_WhenRendered_ThenNoButtonsAndItSaysWhy", async () => {
    await open("dev-and-prod", "none");
    expect(await screen.findByText(/does not deploy \(deploy kind none\)/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
