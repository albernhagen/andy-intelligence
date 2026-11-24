import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { EnvironmentPolicy, ExecutorKind, MergeMode, PlanApproval, Worker } from "@andy/contracts";
import { DEFAULT_ROUTE, MERGE_MODE_TEXT } from "@andy/domain";
import { renderApp } from "@/test/harness";

/**
 * AI-46: one project's settings at /p/<project>/settings, against the in-process API. AI-372: one
 * section at a time beside section links, every picker's options shown with descriptions,
 * switches for on/off settings, and each save confirmed at its control.
 */

async function withProjects(path: string) {
  const h = renderApp(path);
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await h.tracker.createProject({ name: "Ops", key: "OPS" });
  await h.queryClient.invalidateQueries();
  return h;
}

type Harness = ReturnType<typeof renderApp>;

const pathname = (h: Harness) => h.router.state.location.pathname;

const settings = () => screen.findByRole("region", { name: "Settings" });

/** Opens a section by its link, as Andy would, and returns its settings. */
async function open(h: Harness, name: string) {
  const nav = await screen.findByRole("navigation", { name: "Settings sections" });
  await h.user.click(within(nav).getByRole("link", { name: new RegExp(`^${name}`) }));
  return within(await screen.findByRole("region", { name }));
}

const isOn = (el: HTMLElement) => el.getAttribute("aria-checked") === "true";

/** The picked option's name in a radio group, e.g. "Per epic". */
const picked = (group: HTMLElement) =>
  within(group)
    .getAllByRole("radio")
    .find(isOn)
    ?.querySelector(".font-medium")
    ?.textContent?.trim();

/** Every option name shown in a radio group, in order. */
const optionNames = (group: HTMLElement) =>
  within(group)
    .getAllByRole("radio")
    .map((r) => r.querySelector(".font-medium")?.textContent?.trim());

afterEach(() => window.localStorage.clear());

describe("project settings page", () => {
  it("GivenAProjectBoard_WhenAndyPicksProjectSettingsInTheSettingsMenu_ThenThatProjectsSettingsOpen", async () => {
    const h = await withProjects("/p/ops");
    await h.user.click(await screen.findByRole("button", { name: "Settings" }));
    await h.user.click(await screen.findByRole("menuitem", { name: "Project settings" }));

    await waitFor(() => expect(pathname(h)).toBe("/p/ops/settings"));
    expect(await screen.findByText("OPS: Ops settings")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    const current = within(nav).getByRole("link", { name: "Automation" });
    expect(current.getAttribute("aria-current")).toBe("page");
  });

  it("GivenAllProjects_WhenTheSettingsMenuOpens_ThenThereIsNoProjectSettingsItem", async () => {
    const h = await withProjects("/all/inbox");
    await h.user.click(await screen.findByRole("button", { name: "Settings" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Project settings" })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "Models" })).toBeTruthy();
  });

  it("GivenAProject_WhenItsSettingsOpen_ThenSixSectionLinksInOrderAndOneSectionShows", async () => {
    await withProjects("/p/ai/settings");
    const nav = await screen.findByRole("navigation", { name: "Settings sections" });

    const names = within(nav)
      .getAllByRole("link")
      .map((l) => l.textContent?.replace(/\d+ left$/, "").trim());
    expect(names).toEqual([
      "Setup",
      "Automation",
      "Limits",
      "Defaults",
      "Notifications",
      "Changes",
    ]);
    const body = await settings();
    expect(within(body).getByRole("heading", { name: "Automation" })).toBeTruthy();
    expect(within(body).queryByRole("region", { name: "Limits" })).toBeNull();
  });

  it("GivenTheSectionLinks_WhenAndyPicksLimits_ThenTheHashNamesItAndOnlyLimitsShows", async () => {
    const h = await withProjects("/p/ai/settings");

    const limits = await open(h, "Limits");

    expect(h.router.state.location.hash).toBe("limits");
    expect(limits.getByLabelText("Agent tasks at once")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Automation" })).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(nav).getByRole("link", { name: "Limits" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("GivenALinkToASection_WhenItOpens_ThenThatSectionShows", async () => {
    await withProjects("/p/ai/settings#changes");
    expect(await screen.findByText("No settings changes yet.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Automation" })).toBeNull();
  });

  it("GivenEachSection_WhenOpened_ThenItHoldsItsSettings", async () => {
    const h = await withProjects("/p/ai/settings");

    const automation = await open(h, "Automation");
    expect(automation.getByRole("radiogroup", { name: "Merge mode" })).toBeTruthy();
    expect(automation.getByRole("radiogroup", { name: "Plan approval" })).toBeTruthy();
    for (const name of ["Auto-refine", "Builds", "Auto-build"])
      expect(automation.getByRole("switch", { name })).toBeTruthy();

    const limits = await open(h, "Limits");
    expect(limits.getByLabelText("Agent tasks at once")).toBeTruthy();
    expect(limits.getByRole("switch", { name: "Paused" })).toBeTruthy();
    expect(limits.getByLabelText("Questions per day")).toBeTruthy();
    expect(await limits.findByRole("region", { name: "Spend caps" })).toBeTruthy();

    const defaults = await open(h, "Defaults");
    for (const name of ["Default worker", "Default executor", "Environments"])
      expect(defaults.getByRole("radiogroup", { name })).toBeTruthy();

    const notifications = await open(h, "Notifications");
    expect(notifications.getByRole("switch", { name: "Email notifications" })).toBeTruthy();

    await open(h, "Setup");
    expect(await screen.findByRole("region", { name: "Project plan" })).toBeTruthy();
  });

  it("GivenStoredSettings_WhenThePageOpens_ThenEverySettingShowsItsValueByName", async () => {
    const h = renderApp("/p/ai/settings");
    await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    await h.tracker.updateProject("ai", {
      buildEnabled: true,
      buildEnabledBy: "andy@example.com",
      buildEnabledAt: "2026-11-08T12:00:00.000Z",
      autoBuild: true,
      planApproval: "m-and-l",
      autoRefine: false,
      dailyQuestionCap: 7,
      mergeMode: "epic",
      runsAtOnce: 3,
      paused: true,
      defaultWorker: "ask",
      executor: "local",
      environments: "dev-and-prod",
      lastDispatch: { decision: "paused", at: "2026-11-09T12:00:00.000Z" },
    });
    await h.queryClient.invalidateQueries();

    const automation = await open(h, "Automation");
    expect(isOn(automation.getByRole("switch", { name: "Builds" }))).toBe(true);
    expect(automation.getByText(/\(on since /)).toBeTruthy();
    expect(isOn(automation.getByRole("switch", { name: "Auto-build" }))).toBe(true);
    expect(isOn(automation.getByRole("switch", { name: "Auto-refine" }))).toBe(false);
    expect(picked(automation.getByRole("radiogroup", { name: "Plan approval" }))).toBe(
      "Medium and large",
    );
    expect(picked(automation.getByRole("radiogroup", { name: "Merge mode" }))).toBe("Per epic");
    expect(automation.getByText(/over MCP it can only be tightened/)).toBeTruthy();

    const limits = await open(h, "Limits");
    expect((limits.getByLabelText("Agent tasks at once") as HTMLInputElement).value).toBe("3");
    expect((limits.getByLabelText("Questions per day") as HTMLInputElement).value).toBe("7");
    expect(isOn(limits.getByRole("switch", { name: "Paused" }))).toBe(true);
    expect(limits.getByText("Dispatch: paused by you")).toBeTruthy();

    const defaults = await open(h, "Defaults");
    expect(picked(defaults.getByRole("radiogroup", { name: "Default worker" }))).toBe(
      "Ask each ticket",
    );
    expect(picked(defaults.getByRole("radiogroup", { name: "Default executor" }))).toBe(
      "Local runner",
    );
    expect(picked(defaults.getByRole("radiogroup", { name: "Environments" }))).toBe("Dev and prod");
  });

  it("GivenMergeMode_WhenAndyOpensAutomation_ThenAllFourModesShowWithNameDescriptionAndWhatWaits", async () => {
    const h = await withProjects("/p/ai/settings");
    const group = (await open(h, "Automation")).getByRole("radiogroup", { name: "Merge mode" });

    expect(optionNames(group)).toEqual(["Manual", "Per epic", "Low risk", "All clean"]);
    const radios = within(group).getAllByRole("radio");
    const YOU_MERGE = [
      "You merge: every PR",
      "You merge: one PR per epic, and tickets with no epic",
      "You merge: high-risk PRs",
      "You merge: kept kinds only",
    ];
    MergeMode.options.forEach((mode, i) => {
      expect(radios[i]!.textContent).toContain(MERGE_MODE_TEXT[mode]);
      expect(radios[i]!.textContent).toContain(YOU_MERGE[i]);
    });
    expect(within(group.parentElement!).getByText("← Strictest")).toBeTruthy();
    expect(within(group.parentElement!).getByText("Loosest →")).toBeTruthy();
  });

  it("GivenEveryPicker_WhenItsSectionOpens_ThenEachOptionHasAPlainNameAndADescription", async () => {
    const h = await withProjects("/p/ai/settings");
    const RAW = new Set<string>([
      ...MergeMode.options,
      ...PlanApproval.options,
      ...Worker.options,
      ...ExecutorKind.options,
      ...EnvironmentPolicy.options,
    ]);
    const groups = [...(await open(h, "Automation")).getAllByRole("radiogroup")].map((g) => ({
      name: g.getAttribute("aria-label"),
      names: optionNames(g),
      g,
    }));
    const check = (list: typeof groups) => {
      for (const { names, g } of list) {
        for (const name of names) expect(RAW.has(name ?? "")).toBe(false);
        for (const radio of within(g).getAllByRole("radio"))
          expect(
            radio.querySelector(".text-muted-foreground")?.textContent?.length,
          ).toBeGreaterThan(10);
      }
    };
    check(groups);
    expect(groups.find((x) => x.name === "Plan approval")?.names).toEqual([
      "Never",
      "Medium and large",
      "Every ticket",
    ]);

    const defaults = (await open(h, "Defaults"))
      .getAllByRole("radiogroup")
      .map((g) => ({ name: g.getAttribute("aria-label"), names: optionNames(g), g }));
    check(defaults);
    expect(defaults.map((x) => x.names)).toEqual([
      ["Agent", "Me", "Ask each ticket"],
      ["GitHub Actions", "Local runner"],
      ["Prod only", "Dev and prod"],
    ]);
  });

  it("GivenASetting_WhenChanged_ThenItSavesAtOnceAndSaysSavedAtThatControl", async () => {
    const h = await withProjects("/p/ai/settings");
    const automation = await open(h, "Automation");
    const toggle = automation.getByRole("switch", { name: "Auto-refine" });

    await h.user.click(toggle);

    const row = toggle.closest("label")!;
    expect(await within(row).findByText("Saved")).toBeTruthy();
    expect((await h.tracker.getProject("ai"))?.autoRefine).toBe(false);
    // Only the changed setting confirms.
    const builds = automation.getByRole("switch", { name: "Builds" }).closest("label")!;
    expect(within(builds).queryByText("Saved")).toBeNull();
  });

  it("GivenARefusedValue_WhenItIsSaved_ThenTheApisMessageShowsAtThatControl", async () => {
    const h = await withProjects("/p/ai/settings");
    const limits = await open(h, "Limits");
    const box = limits.getByLabelText("Questions per day");

    await h.user.clear(box);
    await h.user.type(box, "99");
    await h.user.tab();

    const row = box.closest("div.border-b") as HTMLElement;
    const alert = await within(row).findByRole("alert");
    expect(alert.textContent).toMatch(/50/);
    expect(within(row).queryByText("Saved")).toBeNull();
    expect((await h.tracker.getProject("ai"))?.dailyQuestionCap).toBe(5);
  });

  it("GivenBuildsOff_WhenThePageOpens_ThenAutoBuildIsDisabledAndTurningBuildsOnSavesWhoAndWhen", async () => {
    const h = await withProjects("/p/ai/settings");
    const automation = await open(h, "Automation");
    const autoBuild = automation.getByRole("switch", { name: "Auto-build" }) as HTMLButtonElement;
    expect(autoBuild.disabled).toBe(true);

    await h.user.click(automation.getByRole("switch", { name: "Builds" }));

    await waitFor(() => expect(autoBuild.disabled).toBe(false));
    expect(await automation.findByText(/\(on since /)).toBeTruthy();
    expect(await h.tracker.getProject("ai")).toMatchObject({
      buildEnabled: true,
      buildEnabledBy: "andy@example.com",
    });
  });

  it("GivenAProject_WhenAndyChangesSettings_ThenEachSavesThroughThePatchAndShowsTheSavedValue", async () => {
    const h = await withProjects("/p/ai/settings");

    const automation = await open(h, "Automation");
    await h.user.click(automation.getByRole("radio", { name: /^Every ticket/ }));
    await waitFor(async () => expect((await h.tracker.getProject("ai"))?.planApproval).toBe("all"));
    await waitFor(() =>
      expect(picked(automation.getByRole("radiogroup", { name: "Plan approval" }))).toBe(
        "Every ticket",
      ),
    );

    const defaults = await open(h, "Defaults");
    await h.user.click(defaults.getByRole("radio", { name: /^Dev and prod/ }));
    await waitFor(async () =>
      expect((await h.tracker.getProject("ai"))?.environments).toBe("dev-and-prod"),
    );
    await h.user.click(defaults.getByRole("radio", { name: /^Me/ }));
    await waitFor(async () => expect((await h.tracker.getProject("ai"))?.defaultWorker).toBe("me"));

    const limits = await open(h, "Limits");
    await h.user.click(limits.getByRole("switch", { name: "Paused" }));
    await waitFor(async () => expect((await h.tracker.getProject("ai"))?.paused).toBe(true));

    const dial = limits.getByRole("spinbutton", { name: "Agent tasks at once" });
    await waitFor(() => expect((dial as HTMLInputElement).disabled).toBe(false));
    await h.user.clear(dial);
    await h.user.type(dial, "3");
    await h.user.tab();
    await waitFor(async () => expect((await h.tracker.getProject("ai"))?.runsAtOnce).toBe(3));

    // The other project is untouched.
    expect(await h.tracker.getProject("ops")).toMatchObject({
      planApproval: "none",
      paused: false,
      runsAtOnce: 2,
      environments: "prod-only",
    });
  });

  it("GivenAnIdleDecision_WhenLimitsOpen_ThenTheReasonIsShown", async () => {
    const h = renderApp("/p/ai/settings#limits");
    await h.tracker.createProject({ name: "AI", key: "AI" });
    await h.tracker.updateProject("ai", {
      autoBuild: true,
      buildEnabled: true,
      lastDispatch: { decision: "prs_waiting_cap", at: "2026-11-09T12:00:00.000Z" },
    });
    await h.queryClient.invalidateQueries();
    expect(await screen.findByText(/too many agent PRs are waiting/)).toBeTruthy();
  });

  it("GivenAnUnknownProject_WhenItsSettingsOpen_ThenNotFound", async () => {
    await withProjects("/p/nope/settings");
    expect(await screen.findByText("Project not found.")).toBeTruthy();
  });

  it("GivenAProjectStoredBeforeMergeModes_WhenAModeIsPicked_ThenItIsSavedAndTheSuggestionGoes", async () => {
    const h = renderApp("/p/ops/settings");
    await h.tracker.createProject({ name: "Ops", key: "OPS" });
    await h.tracker.updateProject("ops", { mergeMode: null, autoMerge: "none" });
    await h.queryClient.invalidateQueries();
    const automation = await open(h, "Automation");
    const group = automation.getByRole("radiogroup", { name: "Merge mode" });

    // ADR-0134: not set means the gate merges nothing; the old setting only suggests a mode.
    expect(picked(group)).toBeUndefined();
    expect(
      automation.getByText(/Not set: the gate merges nothing\. Suggested: Manual/),
    ).toBeTruthy();
    const manual = within(group).getByRole("radio", { name: /^Manual/ });
    expect(within(manual).getByText("Suggested")).toBeTruthy();

    await h.user.click(within(group).getByRole("radio", { name: /^Low risk/ }));

    await waitFor(async () =>
      expect((await h.tracker.getProject("ops"))?.mergeMode).toBe("low-risk"),
    );
    await waitFor(() => expect(automation.queryByText(/Not set/)).toBeNull());
    expect(within(group).queryByText("Suggested")).toBeNull();
  });
});

describe("/projects", () => {
  it("GivenARememberedProject_WhenProjectsLoads_ThenItRedirectsToThatProjectsSettings", async () => {
    window.localStorage.setItem("andy.scope", "p:ops");
    const h = await withProjects("/projects");
    await waitFor(() => expect(pathname(h)).toBe("/p/ops/settings"));
    expect(await screen.findByText("OPS: Ops settings")).toBeTruthy();
  });

  it("GivenNoRememberedProject_WhenProjectsLoads_ThenItRedirectsToTheFirstProjectsSettings", async () => {
    const h = await withProjects("/projects");
    await waitFor(() => expect(pathname(h)).toBe("/p/ai/settings"));
  });

  it("GivenProjects_WhenAndyPicksAddProject_ThenTheNewProjectFormOpens", async () => {
    const h = await withProjects("/p/ai");
    await h.user.click(await screen.findByRole("button", { name: /AI Andy Intelligence/ }));
    await h.user.click(await screen.findByRole("menuitem", { name: /Add project/ }));
    await waitFor(() => expect(pathname(h)).toBe("/projects/new"));
    expect(screen.getByRole("button", { name: "Create project" })).toBeTruthy();
  });

  // AI-74: the clear sits beside the idle reason while a reading holds dispatch at the reserve.
  describe("clear quota idle", () => {
    const highReading = (takenAt = new Date().toISOString()) => ({
      provider: "claude-sub" as const,
      window: "5h" as const,
      usedPct: 92,
      resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
      source: "test",
      takenAt,
      confidence: "high" as const,
    });

    async function idleAtReserve() {
      const h = renderApp("/p/ai/settings#limits");
      await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
      await h.tracker.updateProject("ai", {
        autoBuild: true,
        buildEnabled: true,
        lastDispatch: { decision: "quota_reserve", at: "2026-11-09T12:00:00.000Z" },
      });
      const reading = highReading();
      await h.quota.save([reading]);
      await h.queryClient.invalidateQueries();
      const list = await settings();
      await within(list).findByText(/Dispatch: subscription quota is at its reserve/);
      return { h, list, reading };
    }

    it("GivenDispatchIdleAtTheReserve_WhenAndyClears_ThenTheButtonGoesAndTheReadingIsDiscarded", async () => {
      const { h, list } = await idleAtReserve();
      await h.user.click(within(list).getByRole("button", { name: "Clear quota idle" }));
      await waitFor(() =>
        expect(within(list).queryByRole("button", { name: "Clear quota idle" })).toBeNull(),
      );
      const [latest] = await h.quota.latest("claude-sub");
      expect(latest?.discarded?.by).toBe("andy@example.com");
    });

    it("GivenTheReadingWasAlreadyCleared_WhenAndyClearsAgain_ThenTheRefusalIsShown", async () => {
      const { h, list, reading } = await idleAtReserve();
      await h.quota.discard("claude-sub", [reading], {
        by: "andy@example.com",
        at: new Date().toISOString(),
      });
      await h.user.click(within(list).getByRole("button", { name: "Clear quota idle" }));
      expect(await within(list).findByText(/nothing to clear/)).toBeTruthy();
    });

    it("GivenQuotaBelowTheReserve_WhenThePageOpens_ThenNoClearIsOffered", async () => {
      const h = renderApp("/p/ai/settings#limits");
      await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
      await h.quota.save([{ ...highReading(), usedPct: 40 }]);
      await h.queryClient.invalidateQueries();
      const list = await settings();
      await within(list).findByRole("switch", { name: "Paused" });
      expect(within(list).queryByRole("button", { name: "Clear quota idle" })).toBeNull();
    });
  });

  it("GivenNoProjectPlan_WhenSetupOpens_ThenThePlanCardOffersATaskOrASession", async () => {
    await withProjects("/p/ai/settings#setup");

    const plan = await screen.findByRole("region", { name: "Project plan" });
    expect(plan.textContent).toContain(
      "No plan yet: start a plan-project agent task, or ask a Claude session to plan this project.",
    );
    expect(within(plan).getByRole("button", { name: "Start plan-project task" })).toBeTruthy();
    expect(plan.textContent).not.toContain("submit_project_plan");
  });

  // AI-320: the same start as MCP start_plan_project and POST …/plan/agent-task.
  it("GivenAConnectedProject_WhenAndyStartsAPlanProjectTask_ThenItStartsAndLinksToTheTask", async () => {
    const h = renderApp("/p/ai/settings#setup", { githubConnected: true });
    await h.tracker.createProject({
      name: "Andy Intelligence",
      key: "AI",
      repos: ["albernhagen/andy-intelligence"],
    });
    await h.queryClient.invalidateQueries();
    const plan = await screen.findByRole("region", { name: "Project plan" });
    await h.user.click(
      await within(plan).findByRole("button", { name: "Start plan-project task" }),
    );

    const link = await within(plan).findByRole("link", { name: "Agent task · plan-project" });
    const [run] = await h.runs.listActive("ai");
    expect(run).toMatchObject({ step: "plan-project", ticketId: null });
    expect(link.getAttribute("href")).toBe(`/p/ai/runs/${run!.id}`);
  });

  it("GivenAPlanProjectTaskInFlight_WhenAndyStartsAnother_ThenTheApisReasonShows", async () => {
    const h = renderApp("/p/ai/settings#setup", { githubConnected: true });
    await h.tracker.createProject({
      name: "Andy Intelligence",
      key: "AI",
      repos: ["albernhagen/andy-intelligence"],
    });
    await h.runs.create({
      projectId: "ai",
      ticketId: null,
      step: "plan-project",
      route: DEFAULT_ROUTE,
      tier: "strong",
      deadline: null,
      prompt: "plan",
      maxTurns: 50,
    });
    await h.queryClient.invalidateQueries();
    const plan = await screen.findByRole("region", { name: "Project plan" });
    await h.user.click(
      await within(plan).findByRole("button", { name: "Start plan-project task" }),
    );

    expect(await within(plan).findByText(/already has a plan-project task in flight/)).toBeTruthy();
    expect(await h.runs.listActive("ai")).toHaveLength(1);
  });
});
