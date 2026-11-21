import { InMemoryNotifyLedger, InMemoryWorkTracker } from "@andy/contracts";
import { EmailNotifications } from "@andy/domain";
import { describe, expect, it } from "vitest";
import { sendTestEmail } from "./notify";

/**
 * AI-289 follow-up: the shared test-email rule refuses a non-owner first, configured or not.
 * The route and `test_email` both call it with their caller (`tools-notify.test.ts` covers both
 * paths for the signed-in owner; every allow-listed caller is the owner today).
 */

function configured() {
  const sent: string[] = [];
  const email = new EmailNotifications({
    tracker: new InMemoryWorkTracker(),
    ledger: new InMemoryNotifyLedger(),
    notifier: { notify: async (n) => void sent.push(n.title) },
    flushQueue: null,
    appUrl: "https://ai.example.com",
  });
  return { email, sent };
}

describe("sendTestEmail (owner only)", () => {
  it.each(["agent:run-1", "system"] as const)(
    "GivenEmailNotConfigured_WhenANonOwner %s_Sends_ThenForbiddenNotNotConfigured",
    async (actor) => {
      await expect(sendTestEmail(null, actor)).rejects.toMatchObject({ code: "forbidden" });
    },
  );

  it("GivenEmailConfigured_WhenANonOwnerSends_ThenForbiddenAndNothingSentOrCounted", async () => {
    const { email, sent } = configured();
    await expect(sendTestEmail(email, "agent:run-1")).rejects.toMatchObject({ code: "forbidden" });
    expect(sent).toEqual([]);
    expect(await email.sentToday()).toBe(0);
  });

  it("GivenTheOwner_WhenSending_ThenNotConfiguredOrSentAsBefore", async () => {
    expect(await sendTestEmail(null, "user:uid-1")).toEqual({
      sent: false,
      status: 409,
      error: "email is not configured",
    });
    const { email, sent } = configured();
    expect(await sendTestEmail(email, "user:uid-1")).toEqual({ sent: true });
    expect(sent).toHaveLength(1);
  });
});
