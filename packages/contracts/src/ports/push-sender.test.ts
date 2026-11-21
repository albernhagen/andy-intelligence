import { describe, expect, it } from "vitest";
import { isPushServiceEndpoint, pushResultForStatus } from "./push-sender";

describe("push-service endpoints (AI-178)", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://web.push.apple.com/QGx",
    "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://wns2-db5p.notify.windows.com/w/?token=x",
  ])("GivenAPushServiceUrl_WhenChecked_ThenAllowed: %s", (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/x",
    "https://fcm.googleapis.com:444/x",
    "https://user:pw@fcm.googleapis.com/x",
    "https://fcm.googleapis.com.evil.example/x",
    "https://evilpush.apple.com/x",
    "https://169.254.169.254/",
    "https://localhost/x",
    "not a url",
  ])("GivenAnOtherUrl_WhenChecked_ThenRefused: %s", (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(false);
  });

  it("GivenStatuses_WhenMapped_ThenSentGoneOrError", () => {
    expect(pushResultForStatus(201)).toEqual({ outcome: "sent", status: 201 });
    expect(pushResultForStatus(410)).toEqual({ outcome: "gone", status: 410 });
    expect(pushResultForStatus(302)).toMatchObject({ outcome: "error", status: 302 });
  });
});
