import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { BRIEF_PATH, DISCOVERY_PATH, renderBrief } from "@andy/domain";
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

async function project(path: string, opts: { brief?: boolean; plan?: ProjectPlan } = {}) {
  const h = renderApp(path, { githubConnected: true });
  await h.tracker.createProject({ name: "Trail log", key: "TRL", repos: [REPO] });
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
  it("GivenAddProject_WhenAndyCreatesAProject_ThenTheBriefStepOpensNotAnEmptyBoard", async () => {
    const h = renderApp("/projects/new", { githubConnected: true });
    await h.user.type(await screen.findByLabelText("Name"), "Trail log");
    await h.user.type(screen.getByLabelText(/^Key/), "TRL");
    await h.user.type(screen.getByLabelText(/^GitHub repo/), REPO);
    await h.user.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByText("What are you building, and for whom?")).toBeTruthy();
    expect(h.router.state.location.pathname).toBe("/p/trl/setup");
    expect(screen.getAllByText("Step 2 of 5", { exact: false }).length).toBeGreaterThan(0);
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
    await h.queryClient.invalidateQueries();
    expect(await screen.findByDisplayValue("Trail runs from the watch.")).toBeTruthy();
  });

  it("GivenANewProjectWithNoTickets_WhenItsBoardOpens_ThenTheNextStepShowsWithOneButtonThatOpensIt", async () => {
    const h = await project("/p/trl");
    const bar = await screen.findByRole("region", { name: "Setup" });
    expect(within(bar).getByText(/step 2 of 5/)).toBeTruthy();
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
});
