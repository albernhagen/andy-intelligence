/* global self, URL */
// Service worker (AI-172, ADR-0052, ADR-0115). Handles `push` and `notificationclick` only.
// No fetch handler and no cache: every request goes to the network as if this file didn't
// exist, so the app is never served stale and nothing signed-in is stored on the device.
// Updates: the browser re-fetches this file on navigation (bypassing the HTTP cache); a
// changed copy installs and takes over at once (skipWaiting + claim are safe without a cache).
// Kill switch: deploy a copy whose `activate` handler calls `self.registration.unregister()`.

const DEFAULT_TITLE = "andy-intelligence";

/** Notification text from a push payload: only string `title`, `body`, `url` are read. */
function noticeFrom(data) {
  let payload;
  try {
    payload = data ? data.json() : {};
  } catch {
    payload = {};
  }
  const pick = (value) => (typeof value === "string" ? value : "");
  return {
    title: pick(payload && payload.title) || DEFAULT_TITLE,
    body: pick(payload && payload.body),
    url: pick(payload && payload.url) || "/",
  };
}

/** The URL to open on tap: the payload's url if it is same-origin, else the app's root. */
function targetUrl(url, origin) {
  try {
    const parsed = new URL(url, origin);
    return parsed.origin === origin ? parsed.href : `${origin}/`;
  } catch {
    return `${origin}/`;
  }
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// iOS revokes push for a site that receives a push without showing a notification,
// so every push shows one, falling back to the default title.
self.addEventListener("push", (event) => {
  const notice = noticeFrom(event.data);
  event.waitUntil(
    self.registration.showNotification(notice.title, {
      body: notice.body,
      data: { url: notice.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const origin = self.location.origin;
  const raw = event.notification.data && event.notification.data.url;
  const url = targetUrl(typeof raw === "string" ? raw : "/", origin);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(`${origin}/`));
      if (!open) return self.clients.openWindow(url);
      // navigate() rejects for a window this worker doesn't control; open a new one then.
      return open
        .navigate(url)
        .then((client) => (client || open).focus())
        .catch(() => self.clients.openWindow(url));
    }),
  );
});
