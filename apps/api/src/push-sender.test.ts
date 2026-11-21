import { createECDH, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { PushTarget } from "@andy/contracts";
import { pushSenderContract } from "@andy/contracts/testing";
import webpush from "web-push";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DisabledPushSender,
  MAX_PUSH_SENDS_PER_HOUR,
  PUSH_DEFAULT_TTL_SECONDS,
  PUSH_MAX_PAYLOAD_BYTES,
  PUSH_MAX_TTL_SECONDS,
  WebPushSender,
  pushConfigFromEnv,
  pushSenderFor,
  type PushConfig,
} from "./push-sender";

/** A local push service: answers `status` (or never, when null) and records each request. */
interface FakePushService {
  url: string;
  requests: { path: string; headers: IncomingMessage["headers"]; body: Buffer }[];
}

const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map((s) => {
      s.closeAllConnections();
      return new Promise((r) => s.close(r));
    }),
  );
});

async function fakePushService(status: number | null): Promise<FakePushService> {
  const service: FakePushService = { url: "", requests: [] };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      service.requests.push({
        path: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      if (status !== null) res.writeHead(status).end();
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  service.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return service;
}

/** A subscription as a browser would make one: a P-256 key and a 16-byte auth secret. */
function subscription(endpoint: string): PushTarget {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint,
    keys: {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}

const vapid = webpush.generateVAPIDKeys();
const config = (service: FakePushService, over: Partial<PushConfig> = {}): PushConfig => ({
  publicKey: vapid.publicKey,
  privateKey: vapid.privateKey,
  testOrigin: service.url,
  ...over,
});
const message = { payload: '{"key":"AI-1","category":"question"}', urgency: "high" as const };
const DEVICE_PATH = "/push/v1/secret-device-token";

pushSenderContract("web-push against a local fake push service", async (status) => {
  const service = await fakePushService(status);
  return {
    sender: new WebPushSender(config(service)),
    target: subscription(`${service.url}${DEVICE_PATH}`),
    delivered: () => service.requests.length,
  };
});

describe("web-push sender (AI-178)", () => {
  it("GivenNoVapidKeys_WhenConfigured_ThenTheSenderIsOffAndSendsNothing", async () => {
    const warn = vi.spyOn(console, "log").mockImplementation(() => {});
    const service = await fakePushService(201);

    const sender = pushSenderFor(pushConfigFromEnv({ VAPID_PUBLIC_KEY: vapid.publicKey }));

    expect(sender.enabled).toBe(false);
    expect(await sender.send(subscription(service.url), message)).toEqual({ outcome: "off" });
    expect(service.requests).toHaveLength(0);
    expect(JSON.parse(warn.mock.calls[0]![0] as string)).toMatchObject({
      severity: "WARNING",
      missing: ["VAPID_PRIVATE_KEY"],
    });
    expect(new DisabledPushSender().enabled).toBe(false);
  });

  it("GivenBothVapidKeys_WhenConfigured_ThenTheSenderIsOn", () => {
    const env = { VAPID_PUBLIC_KEY: ` ${vapid.publicKey} `, VAPID_PRIVATE_KEY: vapid.privateKey };
    expect(pushConfigFromEnv(env)).toEqual({
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
    });
    expect(pushSenderFor(pushConfigFromEnv(env)).enabled).toBe(true);
  });

  it("GivenASend_WhenItReachesTheService_ThenEncryptedWithVapidTtlAndUrgency", async () => {
    const service = await fakePushService(201);

    await new WebPushSender(config(service)).send(
      subscription(`${service.url}${DEVICE_PATH}`),
      message,
    );

    const [req] = service.requests;
    expect(req!.path).toBe(DEVICE_PATH);
    expect(req!.headers).toMatchObject({
      "content-encoding": "aes128gcm",
      ttl: String(PUSH_DEFAULT_TTL_SECONDS),
      urgency: "high",
    });
    expect(req!.headers.authorization).toMatch(/^vapid t=.+, k=.+$/);
    // aes128gcm header: 16-byte salt, 4-byte record size, key id length 65 (the sender's key).
    expect(req!.body[20]).toBe(65);
    expect(req!.body.includes(Buffer.from("AI-1"))).toBe(false);
  });

  it("GivenATtlOverTheCap_WhenSent_ThenTheTtlIsCapped", async () => {
    const service = await fakePushService(201);

    await new WebPushSender(config(service)).send(subscription(service.url), {
      ...message,
      ttlSeconds: PUSH_MAX_TTL_SECONDS * 10,
    });

    expect(service.requests[0]!.headers.ttl).toBe(String(PUSH_MAX_TTL_SECONDS));
  });

  it("GivenAPushServiceThatNeverAnswers_WhenSent_ThenErrorAfterTheTimeout", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const service = await fakePushService(null);
    const started = Date.now();

    const result = await new WebPushSender(config(service, { timeoutMs: 200 })).send(
      subscription(service.url),
      message,
    );

    expect(result).toEqual({ outcome: "error", status: null, reason: "timed out" });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("GivenAServiceError_WhenSent_ThenTheLogLineHasStatusAndHostButNotThePath", async () => {
    const lines = vi.spyOn(console, "log").mockImplementation(() => {});
    const service = await fakePushService(500);

    await new WebPushSender(config(service)).send(
      subscription(`${service.url}${DEVICE_PATH}`),
      message,
    );

    const logged = lines.mock.calls.map((c) => c[0] as string);
    expect(logged.map((l) => JSON.parse(l))).toContainEqual(
      expect.objectContaining({ severity: "ERROR", status: 500, host: new URL(service.url).host }),
    );
    expect(logged.join("\n")).not.toContain("secret-device-token");
  });

  it.each([
    "https://169.254.169.254/computeMetadata/v1/",
    "https://control-plane-abc.a.run.app/api/x",
    "https://fcm.googleapis.com.evil.example/x",
    "https://fcm.googleapis.com:8443/x",
    "http://fcm.googleapis.com/x",
  ])("GivenAnEndpointOffThePushServices_WhenSent_ThenRefusedWithoutARequest", async (endpoint) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await new WebPushSender({
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
    }).send(subscription(endpoint), message);

    expect(result).toMatchObject({ outcome: "error", reason: "endpoint is not a push service" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("GivenTheFakeServiceWithoutTheTestOrigin_WhenSent_ThenRefusedWithoutARequest", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const service = await fakePushService(201);

    const result = await new WebPushSender(config(service, { testOrigin: undefined })).send(
      subscription(service.url),
      message,
    );

    expect(result).toMatchObject({ outcome: "error", reason: "endpoint is not a push service" });
    expect(service.requests).toHaveLength(0);
  });

  it("GivenAPayloadOverTheCap_WhenSent_ThenRefusedWithoutARequest", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const service = await fakePushService(201);

    const result = await new WebPushSender(config(service)).send(subscription(service.url), {
      ...message,
      payload: "x".repeat(PUSH_MAX_PAYLOAD_BYTES + 1),
    });

    expect(result).toMatchObject({ outcome: "error", reason: "payload too large" });
    expect(service.requests).toHaveLength(0);
  });

  it("GivenTheHourlyCapReached_WhenSent_ThenCappedUntilTheNextHour", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const service = await fakePushService(201);
    let now = new Date("2026-11-21T10:00:00Z");
    const sender = new WebPushSender(config(service, { now: () => now }));
    const target = subscription(service.url);
    for (let i = 0; i < MAX_PUSH_SENDS_PER_HOUR; i++) await sender.send(target, message);

    expect(await sender.send(target, message)).toEqual({ outcome: "capped" });
    expect(service.requests).toHaveLength(MAX_PUSH_SENDS_PER_HOUR);
    now = new Date("2026-11-21T11:00:00Z");
    expect(await sender.send(target, message)).toMatchObject({ outcome: "sent" });
  });

  it("GivenBadSubscriptionKeys_WhenSent_ThenErrorWithoutARequest", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const service = await fakePushService(201);
    const target = { endpoint: service.url, keys: { p256dh: "short", auth: "short" } };

    const result = await new WebPushSender(config(service)).send(target, message);

    expect(result).toMatchObject({ outcome: "error", status: null });
    expect(service.requests).toHaveLength(0);
  });
});
