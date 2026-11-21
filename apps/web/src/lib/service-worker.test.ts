import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./service-worker";

const SW_SOURCE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../public/sw.js"),
  "utf8",
);
const ORIGIN = "https://ai.example.com";

type Handler = (event: Record<string, unknown>) => void;

/** Loads public/sw.js into a fake service worker global and returns its handlers. */
function loadWorker(windows: { url: string; navigate: (u: string) => Promise<unknown> }[] = []) {
  const handlers: Record<string, Handler> = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    skipWaiting: vi.fn(),
    registration: { showNotification: vi.fn(() => Promise.resolve()) },
    clients: {
      claim: vi.fn(() => Promise.resolve()),
      matchAll: vi.fn(() => Promise.resolve(windows)),
      openWindow: vi.fn(() => Promise.resolve(null)),
    },
  };
  runInNewContext(SW_SOURCE, { self, URL });
  return { handlers, self };
}

async function fire(handler: Handler, event: Record<string, unknown>): Promise<void> {
  let pending: Promise<unknown> = Promise.resolve();
  handler({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
  await pending;
}

function click(url: unknown) {
  return { notification: { close: vi.fn(), data: { url } } };
}

describe("sw.js", () => {
  it("GivenTheWorker_WhenLoaded_ThenItHasNoFetchHandler", () => {
    const { handlers } = loadWorker();
    expect(Object.keys(handlers).sort()).toEqual([
      "activate",
      "install",
      "notificationclick",
      "push",
    ]);
    expect(SW_SOURCE).not.toMatch(/caches\./);
  });

  it("GivenAPushPayload_WhenPushed_ThenItShowsOnlyTitleBodyAndUrl", async () => {
    const { handlers, self } = loadWorker();
    const data = {
      json: () => ({ title: "AI-150", body: "Question waiting", url: "/t/AI-150", icon: "x" }),
    };
    await fire(handlers.push!, { data });
    expect(self.registration.showNotification).toHaveBeenCalledWith("AI-150", {
      body: "Question waiting",
      data: { url: "/t/AI-150" },
    });
  });

  it("GivenAnUnreadablePayload_WhenPushed_ThenItStillShowsTheDefaultNotification", async () => {
    const { handlers, self } = loadWorker();
    const data = {
      json: () => {
        throw new Error("not json");
      },
    };
    await fire(handlers.push!, { data });
    expect(self.registration.showNotification).toHaveBeenCalledWith("andy-intelligence", {
      body: "",
      data: { url: "/" },
    });
  });

  it("GivenNonStringFields_WhenPushed_ThenTheyAreIgnored", async () => {
    const { handlers, self } = loadWorker();
    await fire(handlers.push!, { data: { json: () => ({ title: 1, body: {}, url: ["x"] }) } });
    expect(self.registration.showNotification).toHaveBeenCalledWith("andy-intelligence", {
      body: "",
      data: { url: "/" },
    });
  });

  it.each([
    ["/t/AI-150", `${ORIGIN}/t/AI-150`],
    [`${ORIGIN}/inbox`, `${ORIGIN}/inbox`],
    ["https://evil.example.com/phish", `${ORIGIN}/`],
    ["//evil.example.com/x", `${ORIGIN}/`],
    ["javascript:alert(1)", `${ORIGIN}/`],
    ["http://ai.example.com/t/AI-1", `${ORIGIN}/`],
    [42, `${ORIGIN}/`],
  ])("GivenUrl %s_WhenTappedWithNoWindowOpen_ThenItOpens %s", async (url, expected) => {
    const { handlers, self } = loadWorker();
    const event = click(url);
    await fire(handlers.notificationclick!, event);
    expect(event.notification.close).toHaveBeenCalled();
    expect(self.clients.openWindow).toHaveBeenCalledWith(expected);
  });

  it("GivenAnOpenAppWindow_WhenTapped_ThenItNavigatesAndFocusesThatWindow", async () => {
    const focus = vi.fn(() => Promise.resolve());
    const win = { url: `${ORIGIN}/board`, navigate: vi.fn(() => Promise.resolve({ focus })) };
    const { handlers, self } = loadWorker([win]);
    await fire(handlers.notificationclick!, click("/t/AI-7"));
    expect(win.navigate).toHaveBeenCalledWith(`${ORIGIN}/t/AI-7`);
    expect(focus).toHaveBeenCalled();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("GivenAnUncontrolledWindow_WhenNavigateFails_ThenItOpensANewWindow", async () => {
    const win = { url: `${ORIGIN}/board`, navigate: vi.fn(() => Promise.reject(new Error("x"))) };
    const { handlers, self } = loadWorker([win]);
    await fire(handlers.notificationclick!, click("/t/AI-7"));
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/t/AI-7`);
  });
});

describe("registerServiceWorker", () => {
  it("GivenServiceWorkerSupport_WhenCalled_ThenItRegistersSwJsAtRootScope", async () => {
    const register = vi.fn(() => Promise.resolve());
    await registerServiceWorker({ serviceWorker: { register } } as unknown as Navigator);
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("GivenNoServiceWorkerSupport_WhenCalled_ThenItDoesNothing", async () => {
    await expect(registerServiceWorker({} as Navigator)).resolves.toBeUndefined();
  });

  it("GivenRegistrationFails_WhenCalled_ThenItLogsAndDoesNotThrow", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const register = vi.fn(() => Promise.reject(new Error("blocked")));
    await registerServiceWorker({ serviceWorker: { register } } as unknown as Navigator);
    expect(error).toHaveBeenCalledWith("service worker registration failed", expect.any(Error));
    error.mockRestore();
  });
});
