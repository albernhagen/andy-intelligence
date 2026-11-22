import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";

/** AI-46: one project's settings at /p/<project>/settings, against the in-process API. */

async function withProjects(path: string) {
  const h = renderApp(path);
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await h.tracker.createProject({ name: "Ops", key: "OPS" });
  await h.queryClient.invalidateQueries();
  return h;
}

const pathname = (h: { router: { state: { location: { pathname: string } } } }) =>
  h.router.state.location.pathname;

const settings = () => screen.findByRole("region", { name: "Settings" });

afterEach(() => window.localStorage.clear());

describe("project settings page", () => {
  it("GivenAProjectBoard_WhenAndyClicksProjectSettingsInTheHeader_ThenThatProjectsSettingsOpen", async () => {
    const h = await withProjects("/p/ops");
    const nav = await screen.findByRole("navigation", { name: "Main" });

    await h.user.click(within(nav).getByRole("link", { name: "Project settings" }));

    await waitFor(() => expect(pathname(h)).toBe("/p/ops/settings"));
    expect(await screen.findByText("OPS: Ops settings")).toBeTruthy();
    const link = within(nav).getByRole("link", { name: "Project settings" });
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("GivenAllProjects_WhenTheHeaderRenders_ThenThereIsNoProjectSettingsLink", async () => {
    await withProjects("/all/inbox");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).queryByRole("link", { name: "Project settings" })).toBeNull();
  });

  it("GivenStoredSettings_WhenThePageOpens_ThenEverySettingShowsItsValueAndWhatItDoes", async () => {
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
      autoMerge: "s",
      mergeMode: "epic",
      runsAtOnce: 3,
      paused: true,
      defaultWorker: "ask",
      executor: "local",
      environments: "dev-and-prod",
      lastDispatch: { decision: "paused", at: "2026-11-09T12:00:00.000Z" },
    });
    await h.queryClient.invalidateQueries();
    const list = await settings();
    const checkbox = (name: string | RegExp) =>
      (within(list).getByRole("checkbox", { name }) as HTMLInputElement).checked;
    const value = (name: string) =>
      (within(list).getByLabelText(name) as HTMLInputElement | HTMLSelectElement).value;

    expect(checkbox(/^Builds/)).toBe(true);
    expect(within(list).getByText(/\(on since /)).toBeTruthy();
    expect(checkbox("Auto-build")).toBe(true);
    expect(value("Plan approval")).toBe("m-and-l");
    expect(checkbox("Auto-refine")).toBe(false);
    expect(value("Questions per day")).toBe("7");
    expect(value("Auto-merge")).toBe("s");
    expect(value("Merge mode")).toBe("epic");
    expect(within(list).getByText(/you merge one PR per epic/)).toBeTruthy();
    expect(value("Agent tasks at once")).toBe("3");
    expect(checkbox("Paused")).toBe(true);
    expect(value("Default worker")).toBe("ask");
    expect(value("Default executor")).toBe("local");
    expect(value("Environments")).toBe("dev-and-prod");
    expect(within(list).getByText("Dispatch: paused by you")).toBeTruthy();
    // One row per setting group, each with its line on what it does, plus spend caps (Limits).
    expect(within(list).getAllByRole("listitem")).toHaveLength(13);
    expect(within(list).getByText(/never over MCP/)).toBeTruthy();
  });

  it("GivenAProject_WhenItsSettingsOpen_ThenFourSectionsInOrderEachWithItsSettings", async () => {
    await withProjects("/p/ai/settings");
    const list = await settings();

    const SECTIONS = ["Automation", "Limits", "Defaults", "Notifications"];
    const names = within(list)
      .getAllByRole("region")
      .map((r) => r.getAttribute("aria-label"));
    expect(names.filter((n) => SECTIONS.includes(n ?? ""))).toEqual(SECTIONS);
    const has = (section: string, name: string | RegExp) =>
      within(within(list).getByRole("region", { name: section })).getByLabelText(name);
    for (const name of [
      /^Builds/,
      "Auto-build",
      "Plan approval",
      "Auto-refine",
      "Auto-merge",
      "Merge mode",
    ])
      expect(has("Automation", name)).toBeTruthy();
    for (const name of ["Agent tasks at once", "Questions per day"])
      expect(has("Limits", name)).toBeTruthy();
    expect(
      await within(within(list).getByRole("region", { name: "Limits" })).findByRole("region", {
        name: "Spend caps",
      }),
    ).toBeTruthy();
    for (const name of ["Default worker", "Default executor", "Environments"])
      expect(has("Defaults", name)).toBeTruthy();
    expect(has("Notifications", /^Email notifications/)).toBeTruthy();
  });

  it("GivenBuildsOff_WhenThePageOpens_ThenAutoBuildIsDisabledAndTurningBuildsOnSavesWhoAndWhen", async () => {
    const h = await withProjects("/p/ai/settings");
    const list = await settings();
    const autoBuild = within(list).getByRole("checkbox", { name: "Auto-build" });
    expect((autoBuild as HTMLInputElement).disabled).toBe(true);

    await h.user.click(within(list).getByRole("checkbox", { name: /^Builds/ }));

    await waitFor(() => expect((autoBuild as HTMLInputElement).disabled).toBe(false));
    expect(await within(list).findByText(/\(on since /)).toBeTruthy();
    expect(await h.tracker.getProject("ai")).toMatchObject({
      buildEnabled: true,
      buildEnabledBy: "andy@example.com",
    });
  });

  it("GivenAProject_WhenAndyChangesSettings_ThenEachSavesThroughThePatchAndShowsTheSavedValue", async () => {
    const h = await withProjects("/p/ai/settings");
    const list = await settings();

    await h.user.click(within(list).getByRole("checkbox", { name: "Auto-refine" }));
    await waitFor(async () => expect((await h.tracker.getProject("ai"))?.autoRefine).toBe(false));
    await waitFor(() =>
      expect(
        (within(list).getByRole("checkbox", { name: "Auto-refine" }) as HTMLInputElement).checked,
      ).toBe(false),
    );

    await h.user.selectOptions(within(list).getByLabelText("Plan approval"), "all");
    await waitFor(async () => expect((await h.tracker.getProject("ai"))?.planApproval).toBe("all"));

    await h.user.selectOptions(within(list).getByLabelText("Environments"), "dev-and-prod");
    await waitFor(async () =>
      expect((await h.tracker.getProject("ai"))?.environments).toBe("dev-and-prod"),
    );

    await h.user.click(within(list).getByRole("checkbox", { name: "Paused" }));
    await waitFor(async () => expect((await h.tracker.getProject("ai"))?.paused).toBe(true));

    const dial = within(list).getByRole("spinbutton", { name: "Agent tasks at once" });
    await waitFor(() => expect((dial as HTMLInputElement).disabled).toBe(false));
    await h.user.clear(dial);
    await h.user.type(dial, "3");
    await h.user.tab();
    await waitFor(async () => expect((await h.tracker.getProject("ai"))?.runsAtOnce).toBe(3));

    // The other project is untouched.
    expect(await h.tracker.getProject("ops")).toMatchObject({
      autoRefine: true,
      planApproval: "none",
      paused: false,
      runsAtOnce: 2,
      environments: "prod-only",
    });
  });

  it("GivenAnIdleDecision_WhenThePageOpens_ThenTheReasonIsShown", async () => {
    const h = renderApp("/p/ai/settings");
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
      const h = renderApp("/p/ai/settings");
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
      const h = renderApp("/p/ai/settings");
      await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
      await h.quota.save([{ ...highReading(), usedPct: 40 }]);
      await h.queryClient.invalidateQueries();
      const list = await settings();
      await within(list).findByRole("checkbox", { name: "Paused" });
      expect(within(list).queryByRole("button", { name: "Clear quota idle" })).toBeNull();
    });
  });

  it("GivenAProjectStoredBeforeMergeModes_WhenAModeIsPicked_ThenItIsSavedAndNoLongerReadFromAutoMerge", async () => {
    const h = renderApp("/p/ops/settings");
    await h.tracker.createProject({ name: "Ops", key: "OPS" });
    await h.tracker.updateProject("ops", { mergeMode: null, autoMerge: "none" });
    await h.queryClient.invalidateQueries();
    const list = await settings();
    const select = () => within(list).getByLabelText("Merge mode") as HTMLSelectElement;

    expect(select().value).toBe("manual");
    expect(within(list).getByText("(read from auto-merge)")).toBeTruthy();

    await h.user.selectOptions(select(), "low-risk");

    await waitFor(async () =>
      expect((await h.tracker.getProject("ops"))?.mergeMode).toBe("low-risk"),
    );
    await waitFor(() => expect(within(list).queryByText("(read from auto-merge)")).toBeNull());
  });
});
