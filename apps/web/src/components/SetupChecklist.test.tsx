import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BASELINE_FILES, setupChecklist } from "@andy/domain";
import { ApiContext, createApi } from "@/lib/api";
import { renderApp } from "@/test/harness";
import { SetupChecklist } from "./SetupChecklist";

/** AI-95: M5.15: the setup checklist on the project settings page. */

const REPO = "albernhagen/andy-intelligence";

async function open(prepare: (h: ReturnType<typeof renderApp>) => void = () => {}) {
  const h = renderApp("/p/ai/settings", { githubConnected: true });
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI", repos: [REPO] });
  prepare(h);
  await h.queryClient.invalidateQueries();
  return within(await screen.findByRole("list", { name: "Setup checklist" }, { timeout: 5000 }));
}

const row = (list: ReturnType<typeof within>, label: string) =>
  within(list.getByText(label).closest("li") as HTMLElement);

describe("setup checklist", () => {
  it("GivenStepsRemain_WhenTheProjectPageOpens_ThenItShowsWhichOnesRemain", async () => {
    const list = await open((h) => {
      for (const path of BASELINE_FILES) h.codeHost.files.set(path, "x");
    });

    expect(row(list, "Repo connected").getByText("Done")).toBeTruthy();
    expect(row(list, "Baseline merged").getByText("Done")).toBeTruthy();
    expect(row(list, "Threat model started").getByText("Missing")).toBeTruthy();
    expect(row(list, "Deploy proven").getByText("not yet (M6: Dev → prod releases)")).toBeTruthy();
    expect(row(list, "Budget caps set").getByText("Not yet")).toBeTruthy();
    expect(screen.getByText(/Setup: 3 of 5 left/)).toBeTruthy();
  });

  it("GivenTheRepoCannotBeRead_WhenTheProjectPageOpens_ThenRepoItemsShowUnknownWithTheError", async () => {
    const list = await open((h) => {
      h.codeHost.readFile = () => Promise.reject(new Error("rate limited"));
    });

    for (const label of ["Repo connected", "Baseline merged", "Threat model started"]) {
      expect(row(list, label).getByText("Unknown")).toBeTruthy();
      expect(row(list, label).getByText(`couldn't read ${REPO}: rate limited`)).toBeTruthy();
    }
    expect(list.queryAllByText("Done")).toHaveLength(0);
  });

  it("GivenEveryStepIsDone_WhenTheChecklistRenders_ThenItIsHidden", async () => {
    const done = setupChecklist(
      { repos: [REPO], monthlyBudgetUsd: 25 },
      { kind: "read", repo: REPO, missingBaselineFiles: [], threatModel: true },
      true,
    );
    let served = false;
    const api = createApi({
      baseUrl: "http://localhost",
      getToken: async () => "t",
      fetch: async () => {
        served = true;
        return new Response(JSON.stringify(done), {
          headers: { "content-type": "application/json" },
        });
      },
    });
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ApiContext.Provider value={api}>
          <SetupChecklist projectId="ai" />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(served).toBe(true));
    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
    expect(container.innerHTML).toBe("");
  });
});
