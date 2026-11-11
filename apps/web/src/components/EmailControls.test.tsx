import { InMemoryNotifyLedger, type Notice } from "@andy/contracts";
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/harness";

/** AI-77: the settings page's email row, against the in-process API. */

async function open(email?: NonNullable<Parameters<typeof renderApp>[1]>["email"]) {
  const h = renderApp("/p/ai/settings", { email });
  await h.tracker.createProject({ name: "Andy Intelligence", key: "AI" });
  await h.queryClient.invalidateQueries();
  const list = await screen.findByRole("list", { name: "Settings" });
  return { h, list };
}

describe("email notifications setting", () => {
  it("GivenEmailIsNotConfigured_WhenThePageOpens_ThenItShowsOffAndCannotBeTurnedOn", async () => {
    const { list } = await open();
    expect(await within(list).findByText("(off: email is not configured)")).toBeTruthy();
    const box = within(list).getByRole("checkbox", {
      name: /Email notifications/,
    }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(true);
    expect(within(list).queryByRole("button", { name: "Send test email" })).toBeNull();
  });

  it("GivenEmailIsConfigured_WhenAndyTurnsItOffAndSendsATest_ThenTheProjectSavesAndOneTestGoesOut", async () => {
    const sent: Notice[] = [];
    const { h, list } = await open({
      notifier: { notify: async (n: Notice) => void sent.push(n) },
      ledger: new InMemoryNotifyLedger(),
      flushQueue: null,
      appUrl: "http://localhost",
    });
    expect(await within(list).findByText("(0 of 20 sent today)")).toBeTruthy();
    const box = within(list).getByRole("checkbox", {
      name: /Email notifications/,
    }) as HTMLInputElement;
    expect(box.checked).toBe(true);

    await h.user.click(box);
    await waitFor(async () =>
      expect((await h.tracker.getProject("ai"))?.emailNotifications).toBe(false),
    );

    await h.user.click(within(list).getByRole("button", { name: "Send test email" }));
    expect(await within(list).findByText("(1 of 20 sent today)")).toBeTruthy();
    expect(sent.map((n) => n.title)).toEqual(["andy-intelligence: test email"]);
  });
});
