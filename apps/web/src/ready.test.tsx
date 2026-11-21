import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";

/** AI-298: Parity: ranked Ready list in the web UI, the same list as MCP `list_ready`. */
describe("ranked Ready list", () => {
  async function seeded(path: string) {
    const h = renderApp("/all/board");
    await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    const ready = async (title: string, fields: Record<string, unknown>) => {
      const t = await h.tracker.createTicket("ai", { type: "chore", title }, "andy");
      await h.tracker.updateTicket(
        "ai",
        t.id,
        { fields, stage: { to: "ready", forced: false, reason: null } },
        "system",
      );
    };
    await ready("Small and safe", {
      size: "S",
      risk: "low",
      riskReason: "one file",
      confidence: "high",
    });
    await ready("Big", { size: "L", risk: "high", confidence: "low" });
    await ready("Unscored", {});
    await h.tracker.createTicket("ai", { type: "chore", title: "Not ready" }, "andy");
    await h.queryClient.invalidateQueries();
    await h.router.navigate({ href: path });
    return h;
  }

  const titles = (list: HTMLElement) =>
    within(list)
      .getAllByRole("link")
      .map((a) => a.textContent);

  it("GivenReadyTickets_WhenTheReadyViewOpens_ThenTheyAreInRankOrderWithScoresAndReasons", async () => {
    await seeded("/p/ai/ready");
    const list = await screen.findByRole("list", { name: "Ready tickets" });
    expect(titles(list)).toEqual(["Small and safe", "Big", "Unscored"]);
    const first = list.querySelector('[data-ticket="AI-1"]') as HTMLElement;
    expect(within(first).getByText("S · low risk · confident")).toBeTruthy();
    expect(within(first).getByText("Risk: one file")).toBeTruthy();
    expect(within(list).getByText("No scores")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ready 3" })).toBeTruthy();
  });

  it("GivenAFilter_WhenAndyPicksIt_ThenTheListAndTheUrlFollow", async () => {
    const h = await seeded("/p/ai/ready");
    await screen.findByRole("list", { name: "Ready tickets" });
    await h.user.selectOptions(screen.getByLabelText("Size"), "S");

    await waitFor(() => expect(h.router.state.location.search).toEqual({ size: "S" }));
    await waitFor(() =>
      expect(titles(screen.getByRole("list", { name: "Ready tickets" }))).toEqual([
        "Small and safe",
      ]),
    );
  });

  it("GivenAFilterInTheUrlThatMatchesNothing_WhenOpened_ThenItSaysSo", async () => {
    await seeded("/p/ai/ready?risk=medium");
    expect(await screen.findByText("No Ready ticket matches.")).toBeTruthy();
  });

  it("GivenTheBoard_WhenAndyFollowsRankedList_ThenTheReadyViewOpens", async () => {
    const h = await seeded("/p/ai");
    const lane = await screen.findByRole("region", { name: "Ready" });
    await h.user.click(within(lane).getByRole("link", { name: "Ranked list" }));
    expect(await screen.findByRole("list", { name: "Ready tickets" })).toBeTruthy();
  });
});
