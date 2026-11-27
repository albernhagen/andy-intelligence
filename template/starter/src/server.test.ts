import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./server.js";

describe("createApp", () => {
  const server = createApp();
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("GivenTheApp_WhenHealthIsRequested_ThenItAnswers200", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
  });

  it("GivenTheApp_WhenTheRootIsRequested_ThenItSaysHello", async () => {
    expect(await (await fetch(`${base}/`)).text()).toBe("Hello, world");
  });

  it("GivenTheApp_WhenAnUnknownPathIsRequested_ThenItAnswers404", async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
