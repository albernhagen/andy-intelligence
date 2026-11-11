import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResendNotifier, emailConfigFromEnv } from "./notifier-email";
import { startFakeEmailServer, type FakeEmailServer } from "./notify-test-server";

describe("emailConfigFromEnv", () => {
  it("GivenNoKey_WhenRead_ThenNullAndEmailNotConfiguredIsLogged", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(emailConfigFromEnv({ EMAIL_FROM: "a@x.test", EMAIL_TO: "b@x.test" })).toBeNull();
    const line = JSON.parse(String(log.mock.calls[0]?.[0])) as {
      message: string;
      missing: string[];
    };
    expect(line.message).toMatch(/^email not configured/);
    expect(line.missing).toEqual(["RESEND_API_KEY"]);
    log.mockRestore();
  });

  it("GivenKeyAndBothAddresses_WhenRead_ThenTheConfig", () => {
    expect(
      emailConfigFromEnv({ RESEND_API_KEY: " k ", EMAIL_FROM: "a@x.test", EMAIL_TO: "b@x.test" }),
    ).toEqual({ apiKey: "k", from: "a@x.test", to: "b@x.test" });
  });
});

describe("ResendNotifier", () => {
  let server: FakeEmailServer;
  beforeEach(async () => (server = await startFakeEmailServer()));
  afterEach(() => server.close());

  const notifier = () =>
    new ResendNotifier({
      apiKey: "re_test",
      from: "a@x.test",
      to: "b@x.test",
      baseUrl: server.baseUrl,
    });

  it("GivenANotice_WhenSent_ThenOnePlainTextEmailWithTheKeyAsBearer", async () => {
    await notifier().notify({ title: "Subject", body: "Body", urgency: "normal" });
    expect(server.requests).toHaveLength(1);
    const [req] = server.requests;
    expect(req?.path).toBe("/emails");
    expect(req?.authorization).toBe("Bearer re_test");
    expect(req?.body).toMatchObject({
      from: "a@x.test",
      to: ["b@x.test"],
      subject: "Subject",
      text: "Body",
    });
    expect(req?.body).not.toHaveProperty("html");
  });

  it("GivenTheProviderRefuses_WhenSent_ThenItThrowsWithoutTheKey", async () => {
    server.status = 422;
    const err = await notifier()
      .notify({ title: "S", body: "B", urgency: "normal" })
      .catch((e: unknown) => e as Error);
    expect(String(err)).toContain("email provider refused the send");
    expect(String(err)).not.toContain("re_test");
  });
});
