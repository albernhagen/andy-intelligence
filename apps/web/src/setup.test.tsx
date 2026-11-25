import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Toaster, resetToasts } from "@/components/ui/toast";
import { BASELINE_FILES, BRIEF_PATH, DISCOVERY_PATH, renderBrief } from "@andy/domain";
import type { BriefAnswers, ProjectPlan } from "@andy/contracts";
import { readyStory, renderApp } from "@/test/harness";

/** AI-373: a new project's setup path, against the in-process API with the GitHub fake. */

const REPO = "albernhagen/andy-intelligence";

const plan: ProjectPlan = {
  status: "proposed",
  proposal: {
    summary: "Smallest slice first.",
    milestones: [
      {
        title: "Sign-in and one run",
        goal: "You sign in and see one run.",
        doneWhen: ["One run shows"],
        slices: ["Sign-in", "Import"],
        case: { serves: "Andy", expectedReturn: "No copying.", cheapestTest: "Import once." },
      },
      { title: "Weekly summary", goal: "Monday totals.", doneWhen: ["Totals"], slices: ["Totals"] },
      { title: "Share", goal: "Friends see runs.", doneWhen: ["Invite"], slices: ["Invites"] },
    ],
  },
  proposedBy: "user:andy",
  proposedAt: "2026-11-12T10:00:00.000Z",
  decidedBy: null,
  decidedAt: null,
  reason: null,
  epicIds: [],
};

/**
 * AI-381: the GitHub and terminal steps done, as the App reads them (baseline files, ruleset,
 * main-only environment) plus Andy's marks for the steps it can't read.
 */
async function onboard(h: ReturnType<typeof renderApp>) {
  for (const path of [...BASELINE_FILES, "pnpm-lock.yaml", ".nvmrc"])
    h.codeHost.files.set(path, "x");
  const key = REPO.toLowerCase();
  h.codeHost.settings.set(`${key}#rulesets`, {
    status: 200,
    data: [{ name: "protect-main", enforcement: "active" }],
  });
  h.codeHost.settings.set(`${key}#environments/agent`, {
    status: 200,
    data: { deployment_branch_policy: { custom_branch_policies: true } },
  });
  h.codeHost.settings.set(`${key}#environments/agent/deployment-branch-policies`, {
    status: 200,
    data: { branch_policies: [{ name: "main", type: "branch" }] },
  });
  const mark = { by: "andy@example.com", at: "2026-11-25T12:00:00.000Z" };
  await h.tracker.updateProject("trl", {
    setupMarks: { reusable_workflows: mark, reviewer_token: mark, agent_environment: mark },
  });
}

async function project(path: string, opts: { brief?: boolean; plan?: ProjectPlan } = {}) {
  const h = renderApp(path, { githubConnected: true });
  await h.tracker.createProject({ name: "Trail log", key: "TRL", repos: [REPO] });
  await onboard(h);
  if (opts.brief) h.codeHost.files.set(BRIEF_PATH, "# Project brief");
  if (opts.plan) await h.tracker.updateProject("trl", { projectPlan: opts.plan });
  await h.queryClient.invalidateQueries();
  return h;
}

/** Types into the labelled field on the current brief page. */
async function fill(h: Awaited<ReturnType<typeof project>>, label: string, text: string) {
  const field = await screen.findByLabelText(label);
  await h.user.clear(field);
  await h.user.type(field, text);
}

describe("setup path", () => {
  it("GivenAddProject_WhenAndyTypesAnInstalledRepo_ThenTheRepoAndAppStepsShowItsLimits", async () => {
    const h = renderApp("/projects/new", { githubConnected: true });
    expect(
      await screen.findByText("Before you add a project: the repo and the GitHub App"),
    ).toBeTruthy();
    expect(screen.getByText("gh repo create <owner>/<name> --public")).toBeTruthy();
    await h.user.type(screen.getByLabelText(/^GitHub repo/), REPO);
    expect(await screen.findByText("App installed")).toBeTruthy();
    expect(screen.getByText("✓ Public")).toBeTruthy();
    expect(screen.getByText(`gh repo create ${REPO} --public`)).toBeTruthy();
  });

  it("GivenAddProject_WhenAndyCreatesAProject_ThenTheBriefStepOpensNotAnEmptyBoard", async () => {
    const h = renderApp("/projects/new", { githubConnected: true });
    await h.user.type(await screen.findByLabelText("Name"), "Trail log");
    await h.user.type(screen.getByLabelText(/^Key/), "TRL");
    await h.user.type(screen.getByLabelText(/^GitHub repo/), REPO);
    await h.user.click(screen.getByRole("button", { name: "Create project" }));
    // AI-381: the repo and App steps came before Add project; the baseline PR is next.
    expect(await screen.findByRole("heading", { name: "Finish the baseline PR" })).toBeTruthy();
    expect(h.router.state.location.pathname).toBe("/p/trl/setup");
    expect(screen.getAllByText("Step 2 of 11", { exact: false }).length).toBeGreaterThan(0);
  });

  it("GivenTheBriefForm_WhenAndySubmitsIt_ThenTheProposedBriefIsWhatSubmitBriefStores", async () => {
    const h = await project("/p/trl/setup");
    await fill(h, "The idea", "A log of trail runs.");
    await fill(h, "The problem it solves", "Runs hide in a watch app.");
    await fill(h, "Who uses it", "Andy.");
    await fill(h, "Business", "None.");
    await h.user.click(screen.getByRole("button", { name: /^Next/ }));
    await fill(h, "Vision", "Monday totals without typing.");
    await fill(h, "Goals, most important first", "Weekly totals{Enter}Zero typing");
    await h.user.click(screen.getByRole("button", { name: /^Next/ }));
    await fill(h, "Stack", "TypeScript.");
    await fill(h, "Cloud", "GCP.");
    await fill(h, "Environments", "Dev and prod.");
    await fill(h, "Quality bar", "Tests pass.");
    await h.user.click(screen.getByRole("button", { name: /^Next/ }));
    await fill(h, "Constraints", "Free tier only.");
    await h.user.click(screen.getByRole("button", { name: /^Propose the brief/ }));

    expect(await screen.findByText("Merge the brief to go on")).toBeTruthy();
    const expected: BriefAnswers = {
      projectName: "Trail log",
      idea: "A log of trail runs.",
      problem: "Runs hide in a watch app.",
      users: "Andy.",
      business: "None.",
      vision: "Monday totals without typing.",
      goals: ["Weekly totals", "Zero typing"],
      nonGoals: [],
      stack: "TypeScript.",
      cloud: "GCP.",
      environments: "Dev and prod.",
      constraints: "Free tier only.",
      qualityBar: "Tests pass.",
      openQuestions: [],
    };
    const rendered = renderBrief(expected);
    const proposal = h.codeHost.proposals.find((p) => p.proposal.path === BRIEF_PATH);
    expect(proposal?.proposal.content).toBe(rendered.ok ? rendered.markdown : "");
  });

  it("GivenAPageWithAnUnansweredQuestion_WhenShown_ThenNextIsDisabled", async () => {
    await project("/p/trl/setup");
    expect(await screen.findByText("What are you building, and for whom?")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Next/ }).hasAttribute("disabled")).toBe(true);
  });

  it("GivenADiscoveryDoc_WhenTheBriefStepOpens_ThenItsAnswersPreFillTheForm", async () => {
    const h = renderApp("/p/trl/setup", { githubConnected: true });
    h.codeHost.files.set(
      DISCOVERY_PATH,
      "## Brief answers\n\n| Id | Answer |\n|---|---|\n| `idea` | Trail runs from the watch. |\n",
    );
    await h.tracker.createProject({ name: "Trail log", key: "TRL", repos: [REPO] });
    await onboard(h);
    await h.queryClient.invalidateQueries();
    expect(await screen.findByDisplayValue("Trail runs from the watch.")).toBeTruthy();
  });

  it("GivenANewProjectWithNoTickets_WhenItsBoardOpens_ThenTheNextStepShowsWithOneButtonThatOpensIt", async () => {
    const h = await project("/p/trl");
    const bar = await screen.findByRole("region", { name: "Setup" });
    expect(within(bar).getByText(/step 7 of 11/)).toBeTruthy();
    const buttons = within(bar).getAllByRole("link");
    expect(buttons).toHaveLength(1);
    await h.user.click(buttons[0]!);
    expect(await screen.findByText("What are you building, and for whom?")).toBeTruthy();
  });

  it("GivenAProjectWithStoryTickets_WhenItsBoardOpens_ThenNoSetupBar", async () => {
    const h = await project("/p/trl");
    await h.service.create("trl", readyStory, "user:andy");
    await h.queryClient.invalidateQueries();
    expect(await screen.findByText("Board", { selector: "h2", exact: false })).toBeTruthy();
    await screen.findAllByText("Board");
    expect(screen.queryByRole("region", { name: "Setup" })).toBeNull();
  });

  it("GivenTheBriefNotMerged_WhenSetupOpens_ThenThePlanStepCannotBeOpenedYet", async () => {
    await project("/p/trl/setup");
    expect(await screen.findByText("What are you building, and for whom?")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Plan milestones/ }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("GivenTheBriefMerged_WhenSetupOpens_ThenThePlanStepIsCurrentWithItsOneButton", async () => {
    await project("/p/trl/setup", { brief: true });
    expect(await screen.findByRole("heading", { name: "Plan milestones" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Start the plan agent/ })).toBeTruthy();
  });

  it("GivenAProposedPlan_WhenAndyParksOneAndApproves_ThenTwoAreApprovedAndOneParked", async () => {
    const h = await project("/p/trl/setup", { brief: true, plan });
    await screen.findByRole("heading", { name: "Approve the plan" });
    expect(screen.getByText(/Serves: Andy\. Expected return: No copying\./)).toBeTruthy();
    await h.user.click(
      within(screen.getByRole("group", { name: "M3: Share" })).getByRole("button", {
        name: "Park",
      }),
    );
    await h.user.click(screen.getByRole("button", { name: /^Approve 2, park 1/ }));
    await waitFor(async () =>
      expect((await h.milestones.list("trl")).map((m) => [m.name, m.status])).toEqual([
        ["M1: Sign-in and one run", "approved"],
        ["M2: Weekly summary", "approved"],
        ["M3: Share", "parked"],
      ]),
    );
  });

  it("GivenAParkThatFails_WhenAndyApproves_ThenAToastNamesTheMilestoneAfterTheStepMovesOn", async () => {
    resetToasts();
    render(<Toaster />);
    const h = renderApp("/p/trl/setup", {
      githubConnected: true,
      beforeFetch: async (request) => {
        if (request.method === "PATCH" && request.url.includes("/milestones/"))
          throw new Error("network down");
      },
    });
    await h.tracker.createProject({ name: "Trail log", key: "TRL", repos: [REPO] });
    await onboard(h);
    h.codeHost.files.set(BRIEF_PATH, "# Project brief");
    await h.tracker.updateProject("trl", { projectPlan: plan });
    await h.queryClient.invalidateQueries();
    await screen.findByRole("heading", { name: "Approve the plan" });
    await h.user.click(
      within(screen.getByRole("group", { name: "M3: Share" })).getByRole("button", {
        name: "Park",
      }),
    );
    await h.user.click(screen.getByRole("button", { name: /^Approve 2, park 1/ }));
    expect(await screen.findByText("A milestone wasn't parked")).toBeTruthy();
    expect(screen.getByText(/couldn't park M3: Share/)).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Prove one refine" })).toBeTruthy();
    expect(screen.getByText("A milestone wasn't parked")).toBeTruthy();
  });

  it("GivenASubmittedBrief_WhenAndyReloadsAndEditsIt_ThenEveryAnswerIsStillThere", async () => {
    const draft = { idea: "Trail runs.", vision: "Monday totals." };
    localStorage.setItem("brief-draft:trl", JSON.stringify(draft));
    localStorage.setItem(
      "brief-pr:trl",
      JSON.stringify({ number: 7, url: "https://github.com/albernhagen/andy-intelligence/pull/7" }),
    );
    const h = await project("/p/trl/setup");
    await h.user.click(await screen.findByRole("button", { name: "Edit the brief" }));
    expect(await screen.findByDisplayValue("Trail runs.")).toBeTruthy();
  });

  it("GivenTheBriefMerged_WhenSetupOpens_ThenTheDraftInThisBrowserIsCleared", async () => {
    localStorage.setItem("brief-draft:trl", JSON.stringify({ idea: "Old." }));
    await project("/p/trl/setup", { brief: true });
    await screen.findByRole("heading", { name: "Plan milestones" });
    await waitFor(() => expect(localStorage.getItem("brief-draft:trl")).toBeNull());
  });

  it("GivenAProposedPlan_WhenAndyPressesCmdEnter_ThenTheMainButtonsActionRuns", async () => {
    const h = await project("/p/trl/setup", { brief: true, plan });
    const heading = await screen.findByRole("heading", { name: "Approve the plan" });
    fireEvent.keyDown(heading, { key: "Enter", metaKey: true });
    await waitFor(async () => expect(await h.milestones.list("trl")).toHaveLength(3));
  });

  it("GivenAProposedPlan_WhenSentBackWithANote_ThenThePlanIsRejectedWithThatNote", async () => {
    const h = await project("/p/trl/setup", { brief: true, plan });
    await screen.findByRole("heading", { name: "Approve the plan" });
    await h.user.click(screen.getByRole("button", { name: "Send back with a note" }));
    await h.user.type(screen.getByLabelText("What should the next plan change?"), "Fewer steps.");
    await h.user.click(screen.getByRole("button", { name: "Send back" }));
    await waitFor(async () =>
      expect((await h.tracker.getProject("trl"))?.projectPlan).toMatchObject({
        status: "rejected",
        reason: "Fewer steps.",
      }),
    );
  });

  it("GivenAHandStepTheAppCantRead_WhenAndyMarksItDone_ThenItShowsMarkedByHandAndTheNextStepOpens", async () => {
    const h = await project("/p/trl/setup");
    await h.tracker.updateProject("trl", { setupMarks: {} });
    await h.queryClient.invalidateQueries();
    expect(await screen.findByRole("heading", { name: "Allow reusable workflows" })).toBeTruthy();
    const link = screen.getByRole("link", { name: /Open Actions settings/ });
    expect(link.getAttribute("href")).toBe(`https://github.com/${REPO}/settings/actions`);

    await h.user.click(screen.getByRole("button", { name: /^Mark done/ }));

    expect(await screen.findByRole("heading", { name: "Reviewer token" })).toBeTruthy();
    expect(screen.getByText(`gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${REPO}`)).toBeTruthy();
    const stored = (await h.tracker.getProject("trl"))?.setupMarks.reusable_workflows;
    expect(stored?.by).toBe("andy@example.com");
    await h.user.click(screen.getByRole("button", { name: /Allow reusable workflows/ }));
    expect(await screen.findByText("Marked by hand")).toBeTruthy();
  });

  it("GivenARulesetTheAppMayNotRead_WhenSetupOpens_ThenTheStepSaysCantTellAndOffersMarkDone", async () => {
    const h = renderApp("/p/trl/setup", { githubConnected: true });
    await h.tracker.createProject({ name: "Trail log", key: "TRL", repos: [REPO] });
    await onboard(h);
    h.codeHost.settings.set(`${REPO.toLowerCase()}#rulesets`, { status: 403, data: null });
    await h.queryClient.invalidateQueries();
    const card = await screen.findByRole("region", { name: "Apply the repo settings" });
    expect(within(card).getAllByText("Can't tell").length).toBeGreaterThan(0);
    expect(
      within(card).getByText(`node platform/baseline/baseline.mjs apply ${REPO} --dry-run`),
    ).toBeTruthy();

    await h.user.click(within(card).getByRole("button", { name: /^Mark done/ }));

    expect(await screen.findByText("What are you building, and for whom?")).toBeTruthy();
    expect((await h.tracker.getProject("trl"))?.setupMarks.repo_settings).toBeTruthy();
  });
});
