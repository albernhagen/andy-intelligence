import { describe, expect, it } from "vitest";
import type { PushSender, PushTarget } from "../ports/push-sender";

/**
 * A sender wired to a push service that answers `status`, and how many requests reached that
 * service. `target` is a subscription the sender can encrypt for.
 */
export interface PushSenderHarness {
  sender: PushSender;
  target: PushTarget;
  delivered: () => number;
}

export function pushSenderContract(
  name: string,
  make: (status: number) => Promise<PushSenderHarness>,
): void {
  describe(`PushSender contract: ${name}`, () => {
    const message = { payload: '{"key":"AI-1"}', urgency: "normal" as const };

    it("GivenTheServiceAnswers201_WhenSent_ThenSent", async () => {
      const h = await make(201);
      expect(h.sender.enabled).toBe(true);
      expect(await h.sender.send(h.target, message)).toEqual({ outcome: "sent", status: 201 });
      expect(h.delivered()).toBe(1);
    });

    it.each([404, 410])("GivenTheServiceAnswers%i_WhenSent_ThenGone", async (status) => {
      const h = await make(status);
      expect(await h.sender.send(h.target, message)).toEqual({ outcome: "gone", status });
    });

    it.each([400, 413, 429, 500])("GivenTheServiceAnswers%i_WhenSent_ThenError", async (status) => {
      const h = await make(status);
      expect(await h.sender.send(h.target, message)).toMatchObject({ outcome: "error", status });
    });

    it("GivenAnEndpointThatIsNoUrl_WhenSent_ThenErrorAndNothingReachesTheService", async () => {
      const h = await make(201);
      const bad = { ...h.target, endpoint: "not a url" };
      expect(await h.sender.send(bad, message)).toMatchObject({ outcome: "error", status: null });
      expect(h.delivered()).toBe(0);
    });
  });
}
