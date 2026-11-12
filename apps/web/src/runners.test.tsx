import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";

/** AI-79 (ADR-0089 slice 3): Settings → Local runners. */

describe("runners page", () => {
  it("GivenAProject_WhenAndyMintsARunner_ThenTheSecretShowsOnceAndOnlyItsHashIsStored", async () => {
    const h = renderApp("/settings/runners");
    await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    await h.queryClient.invalidateQueries();

    await h.user.click(await screen.findByRole("checkbox", { name: "AI: Andy Intelligence" }));
    await h.user.click(screen.getByRole("button", { name: "Create runner secret" }));

    const secret = (await screen.findByRole("textbox", {
      name: "Runner secret",
    })) as HTMLInputElement;
    expect(secret.value).toMatch(/^air_/);
    const [stored] = await h.runners.list();
    expect(stored).toMatchObject({ name: "Andy's Mac", projectIds: ["ai"] });
    expect(JSON.stringify(stored)).not.toContain(secret.value);

    await h.user.click(screen.getByRole("button", { name: "I've copied it" }));
    expect(screen.queryByRole("textbox", { name: "Runner secret" })).toBeNull();
    const list = await screen.findByRole("list", { name: "Runners" });
    expect(within(list).getByText("Away")).toBeTruthy();
  });

  it("GivenARunner_WhenAndyRevokesIt_ThenItReadsRevoked", async () => {
    const h = renderApp("/settings/runners");
    await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
    await h.queryClient.invalidateQueries();
    await h.user.click(await screen.findByRole("checkbox", { name: "AI: Andy Intelligence" }));
    await h.user.click(screen.getByRole("button", { name: "Create runner secret" }));
    await h.user.click(await screen.findByRole("button", { name: "I've copied it" }));

    await h.user.click(await screen.findByRole("button", { name: "Revoke" }));

    expect(await screen.findByText("Revoked")).toBeTruthy();
    expect((await h.runners.list())[0]?.revokedAt).not.toBeNull();
  });
});
