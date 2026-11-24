import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HarnessKey, ProviderKey, RunStep, TierKey } from "@andy/contracts";
import { renderApp } from "@/test/harness";
import { HARNESS_LABELS, PROVIDER_LABELS, STEP_LABELS, TIER_LABELS } from "@/lib/settings-labels";
import { stubResizeObserver } from "@/test/resize-observer";

// Models renders Radix Switch, which needs ResizeObserver (AI-376).
stubResizeObserver();

/**
 * AI-243: M9.8, rebuilt by AI-376: Models: Settings → Models against the in-process API and
 * routing store. Every change collects in one save bar; Save writes them as one change.
 */

beforeAll(() => {
  // jsdom lacks the pointer-capture and scroll APIs Radix Select calls.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

async function modelsPage() {
  const h = renderApp("/settings/models");
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await h.queryClient.invalidateQueries();
  const form = await screen.findByRole("form", { name: "Global routing" });
  return { h, form };
}

const tier = (name: string) => screen.getByRole("region", { name: `Tier ${name}` });

/** Each route's model as the card shows it, from its Edit button. */
const routeNames = (name: string) =>
  within(tier(name))
    .getAllByRole("listitem")
    .map((li) => li.querySelector("[data-model]")?.textContent);

const bar = () => screen.queryByRole("region", { name: "Unsaved changes" });

/** Adds a fallback route to a tier; its sheet opens. */
async function addRoute(h: Awaited<ReturnType<typeof modelsPage>>["h"], name: string) {
  await h.user.click(within(tier(name)).getByRole("button", { name: "Add a fallback route" }));
  return screen.findByRole("dialog");
}

describe("Models settings page", () => {
  it("GivenTheDefaults_WhenOpened_ThenEveryTierStepAndProviderShowsAPlainNameAndDescription", async () => {
    const { h, form } = await modelsPage();
    for (const key of TierKey.options) {
      const card = within(form).getByRole("region", { name: `Tier ${TIER_LABELS[key].name}` });
      expect(within(card).getByText(TIER_LABELS[key].description)).toBeTruthy();
    }
    await h.user.click(within(form).getByRole("button", { name: /more steps/ }));
    for (const step of RunStep.options) {
      const row = within(form).getByRole("listitem", { name: STEP_LABELS[step].name });
      expect(within(row).getByText(STEP_LABELS[step].description)).toBeTruthy();
    }
    for (const key of ProviderKey.options) {
      const row = within(form).getByRole("listitem", { name: PROVIDER_LABELS[key].name });
      expect(
        within(row).getByRole("switch", { name: `${PROVIDER_LABELS[key].name} on` }),
      ).toBeTruthy();
    }
    expect(
      within(form)
        .getByRole("switch", { name: "Claude subscription on" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      within(form).getByRole("switch", { name: "OpenRouter on" }).getAttribute("aria-checked"),
    ).toBe("false");
    // Plain names, never the raw ids.
    for (const id of [...ProviderKey.options, ...HarnessKey.options]) {
      expect(form.textContent).not.toContain(id);
    }
    expect(routeNames("Frontier")).toEqual(["Opus"]);
    expect(within(tier("Frontier")).getByText("Runs now")).toBeTruthy();
    expect(bar()).toBeNull();
  });

  it("GivenARouteSheet_WhenOpened_ThenEveryHarnessAndProviderShowsItsDescription", async () => {
    const { h } = await modelsPage();
    await h.user.click(within(tier("Fast")).getByRole("button", { name: "Edit Fast route 1" }));
    const sheet = await screen.findByRole("dialog");
    const harness = within(sheet).getByRole("radiogroup", { name: "Fast route 1 harness" });
    for (const key of HarnessKey.options) {
      expect(within(harness).getByText(HARNESS_LABELS[key].name)).toBeTruthy();
      expect(within(harness).getByText(HARNESS_LABELS[key].description)).toBeTruthy();
    }
    const provider = within(sheet).getByRole("radiogroup", { name: "Fast route 1 provider" });
    for (const key of ProviderKey.options) {
      expect(within(provider).getByText(PROVIDER_LABELS[key].description)).toBeTruthy();
    }
  });

  it("GivenAFallbackOnAProviderThatIsOff_WhenAdded_ThenItSaysSkippedAndTheFirstRunsNow", async () => {
    const { h } = await modelsPage();
    const sheet = await addRoute(h, "Fast");
    await h.user.click(within(sheet).getByRole("radio", { name: /OpenRouter/ }));
    await h.user.click(within(sheet).getByRole("button", { name: "Done" }));

    const second = within(tier("Fast")).getByRole("listitem", { name: "Fast route 2" });
    expect(within(second).getByText("Skipped: provider off")).toBeTruthy();
    const first = within(tier("Fast")).getByRole("listitem", { name: "Fast route 1" });
    expect(within(first).getByText("Runs now")).toBeTruthy();
    expect(within(tier("Fast")).getByText("Edited")).toBeTruthy();
  });

  it("GivenAnEdit_WhenMade_ThenTheBarCountsAndNamesItAndNothingIsSavedYet", async () => {
    const { h } = await modelsPage();
    await addRoute(h, "Fast");
    await h.user.keyboard("{Escape}");

    const region = bar()!;
    expect(within(region).getByText("1 unsaved change")).toBeTruthy();
    expect(within(region).getByText("Fast: added route 2")).toBeTruthy();
    expect((await h.routing.getGlobal()).updatedAt).toBeNull();
  });

  it("GivenEditsInThreeParts_WhenSaved_ThenOneSaveStoresAllAndEachPartSaysSaved", async () => {
    const { h, form } = await modelsPage();
    await addRoute(h, "Cheap");
    await h.user.keyboard("{Escape}");
    const refine = within(form).getByRole("listitem", { name: "Refine" });
    await h.user.click(within(refine).getByRole("button", { name: "Cheap" }));
    await h.user.click(within(form).getByRole("switch", { name: "OpenRouter on" }));
    expect(within(bar()!).getByText("3 unsaved changes")).toBeTruthy();
    expect(within(bar()!).getByText(/Refine: Fast → Cheap/)).toBeTruthy();
    // Nothing applies until Save, the switch included.
    expect((await h.routing.getGlobal()).providers.openrouter.enabled).toBe(false);

    await h.user.type(
      within(bar()!).getByRole("textbox", { name: "Reason for the change" }),
      "try it",
    );
    await h.user.click(within(bar()!).getByRole("button", { name: /^Save/ }));

    await waitFor(() => expect(bar()).toBeNull());
    const saved = await h.routing.getGlobal();
    expect(saved.tiers.cheap).toHaveLength(2);
    expect(saved.steps.refine).toBe("cheap");
    expect(saved.providers.openrouter.enabled).toBe(true);
    // Confirmed where each change was made.
    expect(within(tier("Cheap")).getByText("Saved")).toBeTruthy();
    expect(within(refine).getByText("Saved")).toBeTruthy();
    expect(
      within(within(form).getByRole("listitem", { name: "OpenRouter" })).getByText("Saved"),
    ).toBeTruthy();
    const changes = await screen.findByRole("region", { name: "Global changes" });
    expect(await within(changes).findByText(/try it/)).toBeTruthy();
    expect(within(changes).getAllByText(/try it/)).toHaveLength(1);
  });

  it("GivenAnEdit_WhenCmdSIsPressed_ThenItSaves", async () => {
    const { h, form } = await modelsPage();
    const review = within(form).getByRole("listitem", { name: "Review" });
    await h.user.click(within(review).getByRole("button", { name: "Strong" }));
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(async () => expect((await h.routing.getGlobal()).steps.review).toBe("strong"));
    await waitFor(() => expect(bar()).toBeNull());
  });

  it("GivenUnsavedEdits_WhenDiscarded_ThenTheDraftReturnsToTheSavedRouting", async () => {
    const { h } = await modelsPage();
    await addRoute(h, "Cheap");
    await h.user.keyboard("{Escape}");
    expect(routeNames("Cheap")).toHaveLength(2);
    await h.user.click(within(bar()!).getByRole("button", { name: "Discard" }));
    expect(routeNames("Cheap")).toEqual(["Sonnet"]);
    expect(bar()).toBeNull();
    expect((await h.routing.getGlobal()).updatedAt).toBeNull();
  });

  it("GivenAnIncompatibleRoute_WhenSaved_ThenTheApiReasonSitsByThatRouteAndTheDraftStays", async () => {
    const { h } = await modelsPage();
    const sheet = await addRoute(h, "Fast");
    await h.user.click(within(sheet).getByRole("radio", { name: /Jules/ }));
    expect(
      within(sheet).getByText(/harness jules doesn't run on provider claude-sub/),
    ).toBeTruthy();
    await h.user.click(within(sheet).getByRole("button", { name: "Done" }));

    await h.user.click(within(bar()!).getByRole("button", { name: /^Save/ }));

    const row = within(tier("Fast")).getByRole("listitem", { name: "Fast route 2" });
    const refused = await within(row).findByRole("alert");
    expect(refused.textContent).toContain("Refused");
    expect(refused.textContent).toContain("harness jules doesn't run on provider claude-sub");
    expect(routeNames("Fast")).toHaveLength(2);
    expect(bar()).not.toBeNull();
    expect((await h.routing.getGlobal()).updatedAt).toBeNull();

    // Any edit clears the old refusal: its route numbers may no longer match.
    await h.user.click(within(row).getByRole("button", { name: "Edit Fast route 2" }));
    await h.user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Remove Fast route 2",
      }),
    );
    expect(within(tier("Fast")).queryByText(/Refused/)).toBeNull();
  });

  it("GivenTwoRoutes_WhenReorderedAndSaved_ThenAReloadShowsTheNewOrder", async () => {
    const { h, form } = await modelsPage();
    const sheet = await addRoute(h, "Cheap");
    const model = within(sheet).getByRole("textbox", { name: "Cheap route 2 model" });
    await h.user.clear(model);
    await h.user.type(model, "haiku");
    await h.user.click(within(sheet).getByRole("button", { name: "Move Cheap route 2 up" }));
    await h.user.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(routeNames("Cheap")).toEqual(["Haiku", "Sonnet"]);

    await h.user.click(within(bar()!).getByRole("button", { name: /^Save/ }));
    await waitFor(async () =>
      expect((await h.routing.getGlobal()).tiers.cheap.map((r) => r.model)).toEqual([
        "haiku",
        "sonnet",
      ]),
    );
    await h.queryClient.resetQueries();
    await screen.findByRole("form", { name: "Global routing" });
    await waitFor(() => expect(routeNames("Cheap")).toEqual(["Haiku", "Sonnet"]));
    expect(form).toBeTruthy();
  });

  it("GivenAProjectWithoutItsOwnRouting_WhenPicked_ThenItsNarrowedViewAndAProjectEditor", async () => {
    const { h } = await modelsPage();
    await h.user.click(screen.getByRole("combobox", { name: "Routing for" }));
    await h.user.click(await screen.findByRole("option", { name: /AI: Andy Intelligence/ }));
    expect(await screen.findByText(/This project follows global/)).toBeTruthy();
    const narrowed = screen.getByRole("region", { name: "Narrowed view" });
    // Frontier and Strong both run on Opus by default.
    expect(
      within(narrowed).getAllByText(/Opus \(Claude Code · Claude subscription\)/),
    ).toHaveLength(2);
    expect(screen.getByRole("form", { name: "Routing for ai" })).toBeTruthy();
  });

  it("GivenRoutingChangedElsewhere_WhenItArrives_ThenTheDraftStaysAndReloadIsOffered", async () => {
    const { h, form } = await modelsPage();
    await addRoute(h, "Cheap");
    await h.user.keyboard("{Escape}");
    const current = await h.routing.getGlobal();
    await h.routing.put(
      {
        ...current,
        scope: "global",
        projectId: null,
        steps: { ...current.steps, review: "cheap" },
      },
      null,
    );
    await h.queryClient.invalidateQueries();

    expect(await within(form).findByText(/Routing changed since you opened it/)).toBeTruthy();
    expect(routeNames("Cheap")).toHaveLength(2);
    await h.user.click(within(form).getByRole("button", { name: "Reload" }));
    expect(routeNames("Cheap")).toEqual(["Sonnet"]);
    expect(within(form).queryByText(/Routing changed since/)).toBeNull();
  });

  it("GivenAnOutOfRangePercentage_WhenTyped_ThenSaveIsBlockedAndTheFieldIsNamed", async () => {
    const { h, form } = await modelsPage();
    await h.user.click(
      within(form).getByRole("button", { name: "Edit Claude subscription levels" }),
    );
    const reserve = within(form).getByRole("spinbutton", { name: "Claude subscription reserve" });
    await h.user.clear(reserve);
    expect((reserve as HTMLInputElement).value).toBe("");
    await h.user.type(reserve, "150");
    expect(
      within(bar()!).getByText(/Claude subscription reserve must be a whole number from 0 to 100/),
    ).toBeTruthy();
    expect(
      (within(bar()!).getByRole("button", { name: /^Save/ }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await h.user.clear(reserve);
    await h.user.type(reserve, "25");
    await h.user.click(within(bar()!).getByRole("button", { name: /^Save/ }));
    await waitFor(async () =>
      expect((await h.routing.getGlobal()).providers["claude-sub"].reservePct).toBe(25),
    );
  });

  it("GivenAGlobalSave_WhenRevertedFromTheChangesList_ThenTheEditorShowsTheRevertedRouting", async () => {
    const { h, form } = await modelsPage();
    const review = within(form).getByRole("listitem", { name: "Review" });
    await h.user.click(within(review).getByRole("button", { name: "Cheap" }));
    await h.user.click(within(bar()!).getByRole("button", { name: /^Save/ }));
    const changes = await screen.findByRole("region", { name: "Global changes" });
    const row = await within(changes).findByText("Routing: steps changed");
    await h.user.click(within(row.closest("li")!).getByRole("button", { name: "Revert" }));

    await waitFor(async () => expect((await h.routing.getGlobal()).steps.review).toBe("fast"));
    await waitFor(() =>
      expect(
        within(screen.getByRole("listitem", { name: "Review" }))
          .getByRole("button", { name: "Fast" })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    expect(await within(changes).findByText("Reverted")).toBeTruthy();
  });
});
